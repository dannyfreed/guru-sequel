/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('Botkit');
var mysql = require('mysql');
var Promise = require("bluebird");
var db = require('mysql-promise')();
var express = require('express');
var bodyParser = require('body-parser');
var app     = express();

// Botkit-based Redis store
var Redis_Store = require('./redis_storage.js');
var redis_url = "redis://127.0.0.1:6379"
var redis_store = new Redis_Store({url: redis_url});

Promise.promisifyAll(Botkit);



require('./env.js');

if (!process.env.clientId || !process.env.clientSecret || !process.env.port) {
  console.log('Error: Specify clientId clientSecret and port in environment');
  process.exit(1);
}

//for dev only (makes db info + connection static)
if(process.env.host || process.env.username || process.env.password || process.env.database){
  host = process.env.host;
  username = process.env.username;
  password = process.env.password;
  database = process.env.database;
}

//global variable so we can use it in other functions
connection = mysql.createConnection({
  host     : host,
  user     : username,
  password : password,
  database : database
});
var knex = require('knex')({
  client: 'mysql',
  connection: connection
});

db.configure({
	"host": host,
	"user": username,
	"password": password,
	"database": database
});



var controller = Botkit.slackbot({
  storage: redis_store,
}).configureSlackApp(
  {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    scopes: ['bot'],
  }
);

//handle database creds form


app.use(bodyParser.urlencoded({ extended: true }));

//app.use(express.bodyParser());

app.post('/myaction', function(req, res) {
  res.send('You sent the host "' + req.body.host + '".');
  host = req.body.host;
  username = req.body.username;
  password = req.body.password;
  database = req.body.database;
});

app.listen(8080, function() {
  console.log('Server running at http://127.0.0.1:8080/');
});

controller.setupWebserver(process.env.port,function(err,webserver) {
  controller.createWebhookEndpoints(controller.webserver);

  webserver.get('/',function(req,res) {
    res.sendFile('index.html', {root: __dirname});
  });

  webserver.get('/connect',function(req,res) {
    res.sendFile('connect.html', {root: __dirname});
  });

  controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.sendFile('connect.html', {root: __dirname});
    }
  });
});


// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};
function trackBot(bot) {
  _bots[bot.config.token] = bot;
}

controller.on('create_bot',function(bot,config) {

  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {

      if (!err) {
        trackBot(bot);
      }

      bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
        if (err) {
          console.log(err);
        } else {
          convo.say('I am a bot that has just joined your team');
          convo.say('You must now /invite me to a channel so that I can be of use!');
        }
      });

    });
  }

});


// Handle events related to the websocket connection to Slack
controller.on('rtm_open',function(bot) {
  console.log('** The RTM api just connected!');
});

controller.on('rtm_close',function(bot) {
  console.log('** The RTM api just closed');
  // you may want to attempt to re-open
});

controller.hears('hello','direct_message',function(bot,message) {
  bot.reply(message,'Hello!');
});

controller.hears('^stop','direct_message',function(bot,message) {
  bot.reply(message,'Goodbye');
  bot.rtm.close();
});


queryOptions = new Object();
filter = new Object();
view = new Object();
tableFields = [];

function cleanInputs(){
  if(tableFields.length != 0){
      tableFields.length = 0;
    for (var vals in queryOptions){
        if(queryOptions.vals == "table" && queryOptions.table != ""){
          queryOptions.table = "";
        }
        if(queryOptions.vals == "filter" && queryOptions.filter.field != "" || queryOptions.filter.filter != ""){
          queryOptions.filter.field = "";
          queryOptions.filter.filter = "";
        }
        if(queryOptions.vals == "view" && queryOptions.view.type != "" || queryOptions.view.field != ""){
          queryOptions.view.type = "";
          queryOptions.view.field = "";
        }
    }
  }
}

controller.hears(['question'],['direct_message','direct_mention','mention'],function(bot,message) {
  bot.reply(message, "What do you have a question about?");
  cleanInputs();
  bot.startConversation(message, askTable);
});

function showTables(){
    return new Promise(function (resolve, reject){
        console.log('1. making request');

        db.query('show tables').spread(function (results) {
            var tables = [];
            //put tables in an array
            for(i=0; i<results.length; i++){
              tables.push("`" + results[i]['Tables_in_' + database] + "` ");
            }
            resolve(tables.toString());
        });
    });
}

askTable = function(response, convo){
    showTables().then(function(tables){
        convo.ask(tables, function(response, convo){
            queryOptions.table = response.text;
            console.log(queryOptions);
            askFilterType(response,convo);
            convo.next();
        });
    });
}

function showColumns(table){
    return new Promise(function (resolve, reject){
        console.log('showcolumns. making request');
        var query = 'SHOW COLUMNS FROM ' + selectedTable + ';';
        db.query(query).spread(function (rows) {
            var columns = [];
            //error checking?
            for(var i = 0; i < rows.length; i++){
                //format selections nicely
                var field = "`" + rows[i]["Field"] + "` ";
                //add to columns array
                columns.push(field);
                tableFields.push(field);
            }
            resolve(columns.toString());
        });
    });
};

askFilterType = function(response, convo){
    selectedTable = response.text;
    showColumns(selectedTable).then(function(columns){
        convo.ask("Ok. I've got your list of *" + queryOptions.table + "* right here. Would you like to filter down your answer at all? \n" + columns, function(response, convo){
            //add field to filter object
            filter.field = response.text;
            askFilterDetails(response, convo);
            convo.next();
        })
    })
}

function showFilterDetails(field){
    return new Promise(function (resolve, reject){
        console.log('showcolumns. making request');
        var query = "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + queryOptions.table + "' AND COLUMN_NAME = '" + filter.field + "'";
        db.query(query).spread(function (row) {
            var options = {
              "varchar" : "`Is`, `Is Not`, `Is Empty`, `Not Empty`, `None`",
              "float" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
              "tinyint" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
              "int" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
              "timestamp" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`, `None`",
              "date" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`, `None`",
              "datetime" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`, `None`",
            };
            var dataType = row[0]['DATA_TYPE'];
            filter.dataType = dataType;
            var dataTypeOptions = options[row[0]['DATA_TYPE']];
            resolve(dataTypeOptions);
        });
    });
}

askFilterDetails = function(response, convo){
    field = response.text;
    showFilterDetails(field).then(function(dataTypeOptions){
        convo.ask("What would you like to filter by? \n" + dataTypeOptions, function(response, convo){
            //add filter details to filter object
            filter.filter = response.text;
            //add filter to queryOptions object
            queryOptions.filter = filter;
            askViewBy(response, convo);
            convo.next();
        });
    })
}


//NOT SURE HOW TO PROMISIFY THIS ¯\_(ツ)_/¯
//filterType = column title
askViewBy = function(response, convo){
  convo.ask("What would you like to view by? \n `Raw Data`, `Count`, `Average`, `Sum`, `max`, `min` ",[
    {
      pattern: 'raw data',
      callback: function(response,convo) {
          convo.say('you said ' + response.text);
          viewType = response.text;

          //PERFORM QUERY, RETURN RAW DATA IN EXCEL FILE

          convo.next();
        }
      },
      {
        pattern: 'average',
        callback: function(response,convo) {
          convo.say('What field do you want to get the average of?');
          var viewType = response.text;
          view.type = viewType;
            convo.ask(tableFields.toString(), function(response, convo){
                view.field = response.text;
                queryOptions.view = view;
                query = buildQuery();
                db.query(query).spread(function(results){
                    var key = 'avg(`' + view.field + '`)';
                    var average = results[0][key];
                    convo.say("Average: " + average);
                });
                convo.next();
            });
            convo.next();
        }
      },
      {
        pattern: 'count',
        callback: function(response, convo) {
          var viewType = response.text;
          view.type = viewType;
          view.field = null;
          queryOptions.view = view;
          var query = buildQuery();
          db.query(query).spread(function(results){
              var key = 'count(*)';
              var count = results[0][key];
              convo.say("There have been *" + count + " " + queryOptions.table + "* " + queryOptions.filter.filter.toLowerCase());
          });
        convo.next();
        }
      },
      {
        pattern: 'sum',
        callback: function(response,convo) {
          convo.say('What field do you want to get the sum of?');
          var viewType = response.text;
          view.type = viewType;
          convo.ask(tableFields.toString(), function(response, convo){
            view.field = response.text;
            queryOptions.view = view;
            query = buildQuery();
            db.query(query).spread(function(results){
                var key = 'sum(`' + view.field + '`)';
                var sum = results[0][key];
                convo.say("The sum of " + view.field + "'s is " + sum);
            });
            convo.next();
          });
          convo.next();
        }
      },
        {
        pattern: 'max',
        callback: function(response,convo) {
          convo.say('What field do you want to get the Maximum of?');
          var viewType = response.text;
          view.type = viewType;
          convo.ask(tableFields.toString(), function(response, convo){
            view.field = response.text;
            queryOptions.view = view;
            query = buildQuery();
            connection.query({ sql : query, timeout : 10000 }, function(error, results, fields){
              var key = 'max(`' + view.field + '`)';
              var max = results[0][key];
              convo.say("Maximum: " + max);
            });
            convo.next();
          });
          convo.next();
        }
      },
            {
        pattern: 'min',
        callback: function(response,convo) {
          convo.say('What field do you want to get the Minimum of?');
          var viewType = response.text;
          view.type = viewType;
          convo.ask(tableFields.toString(), function(response, convo){
            view.field = response.text;
            queryOptions.view = view;
            query = buildQuery();
            connection.query({ sql : query, timeout : 10000 }, function(error, results, fields){
              var key = 'min(`' + view.field + '`)';
              var min = results[0][key];
              convo.say("Minimum: " + min);
            });
            convo.next();
          });
          convo.next();
        }
      }
    ]);
  }



controller.storage.teams.all(function(err,teams) {

  if (err) {
    throw new Error(err);
  }

  // connect all teams with bots up to slack!
  for (var t  in teams) {
    if (teams[t].bot) {
      var bot = controller.spawn(teams[t]).startRTM(function(err) {
        if (err) {
          console.log('Error connecting bot to Slack:',err);
        } else {
          trackBot(bot);
        }
      });
    }
  }

});

function buildFilter(){

}

function buildQuery(){

  console.log("Building Query: ", queryOptions);

  var table = queryOptions.table;
  var viewType = queryOptions.view.type.toLowerCase();


  //set filter if there is one
  if(queryOptions.filter != null){
    var filter = queryOptions.filter.filter.toLowerCase();
    var field = queryOptions.filter.field;
    var filterDataType = queryOptions.filter.dataType;
  }

  var whereStatement = null;




  //set where statement based off of filter + field
  if (filter == "today"){
    if (filterDataType == "timestamp"){
      whereStatement = field + " >= CURDATE()";
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "yesterday"){
    if (filterDataType == "timestamp"){
      whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND " + field + " < CURDATE()"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "past 7 days"){
    if (filterDataType == "timestamp"){
      whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND " + field + " < CURDATE()"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "past 30 days"){
    if (filterDataType == "timestamp"){
      whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND " + field + " < CURDATE()"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "last week"){
    if (filterDataType == "timestamp"){
        whereStatement =  "YEAR(" + field + ") = YEAR(CURRENT_DATE - INTERVAL 1 WEEK) AND WEEK(" + field + ") = WEEK(CURRENT_DATE - INTERVAL 1 WEEK)"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "last month"){
    if (filterDataType == "timestamp"){
      whereStatement =  "YEAR(" + field + ") = YEAR(CURRENT_DATE - INTERVAL 1 MONTH) AND MONTH(" + field + ") = MONTH(CURRENT_DATE - INTERVAL 1 MONTH)"
      console.log(whereStatement);
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "last year"){
      if (filterDataType == "timestamp"){
        whereStatement =  "YEAR(" + field + ") = YEAR(CURRENT_DATE - INTERVAL 1 YEAR)"
        console.log(whereStatement);
      }
      else if (filterDataType == "date"){
        //do something
      }
      else if (filterDataType == "datetime"){
        //do something
      }
  }
  else if (filter == "this week"){
      if (filterDataType == "timestamp"){
        whereStatement =  "WEEKOFYEAR(" + field + ") = WEEKOFYEAR(NOW())";
        console.log(whereStatement);
      }
      else if (filterDataType == "date"){
        //do something
      }
      else if (filterDataType == "datetime"){
        //do something
      }
  }
  else if (filter == "this month"){
      if (filterDataType == "timestamp"){
        whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL DAYOFMONTH(CURDATE())-1 DAY)"
        console.log(whereStatement);
      }
      else if (filterDataType == "date"){
        //do something
      }
      else if (filterDataType == "datetime"){
        //do something
      }
  }
  else if (filter == "this year"){
      if (filterDataType == "timestamp"){
        whereStatement =  "YEAR(" + field + ") = YEAR(CURDATE())";
        console.log(whereStatement);
      }
      else if (filterDataType == "date"){
        //do something
      }
      else if (filterDataType == "datetime"){
        //do something
      }
  }


  ///VIEW TYPE///

  if (viewType == "count"){

    console.log(whereStatement);
    //will automatically handle null where statments :)
    var query = knex(table).whereRaw(whereStatement).count();
  }
  else if (viewType == "average"){
    var query = knex(table).avg(view.field);
  }
  else if(viewType == "sum"){
    var query = knex(table).sum(view.field);
  }
  else if(viewType == "min"){
    var query = knex(table).min(view.field);
  }
  else if(viewType == "max"){
    var query = knex(table).max(view.field);
  }

  console.log('the buildquery query is: ' + query.toString());
  return query.toString();

  // if (filter == "today"){
  //   var query = "SELECT * FROM " + choices[0] + " WHERE " + columnTitle + " >= CURDATE()";
  //   console.log('todayyyyy');
  // }
  //
  //
  // //var query = "SELECT * FROM " + choices[0];
  // console.log("The query is" + query);
  // return query;
}
