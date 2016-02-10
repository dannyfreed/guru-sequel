/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('Botkit');
var mysql = require('mysql');
var Promise = require('promise');


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

var controller = Botkit.slackbot({
  json_file_store: './db_slackbutton_bot/',
}).configureSlackApp(
  {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    scopes: ['bot'],
  }
);

//handle database creds form

var express = require('express');
var bodyParser = require('body-parser');
var app     = express();

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

//TODO: ADD ERROR RESPONSE IF USER RESPONDS WITH A TABLE THAT DOESN'T EXIST
askTable = function(response, convo){
  //get the different tables
  connection.query({
    sql : "show tables",
    timeout : 40000
  }, function(error, results, fields){
    var tables = [];
    //put tables in an array
    for(i=0; i<results.length; i++){
      tables.push("`" + results[i]['Tables_in_' + database] + "` ");
    }
    //ask user which table they are interested in (Orders, People, etc.)
    convo.ask(tables.toString(), function(response,convo){
      queryOptions.table = response.text;
      askFilterType(response, convo);
      convo.next();
    });
  });
}

askFilterType = function(response, convo){
  //ask user if they would like to apply any filters
  selectedTable = response.text;

  convo.say("Ok. I've got your list of *" + selectedTable + "* right here. Would you like to apply any filters to narrow your search? (Select a Field to filter by or say `NO`)");

  //get column titles of specified table, put into columns[]
  connection.query('SHOW COLUMNS FROM ' + selectedTable +';', function(err, rows, fields) {
    console.log('query running');
    if(err || rows === undefined){
      convo.say("There was an error getting the schema for table `" + selectedTable + "`");
    }
    else{
      var columns = [];
      for(var i = 0; i < rows.length; i++){
        //format selections nicely
        var field = "`" + rows[i]["Field"] + "` ";
        //add to columns array
        columns.push(field);
        tableFields.push(field);
      }

    //list column titles, ask user to select one
    convo.ask(columns.toString(), function(response, convo){
      //add field to filter object
      var response = response.text.toLowerCase();

      //if user responds no to "Do you want to add a filter"//
      if (response == "no" || response =="nah" || response =="nope" || response == "n"){
        queryOptions.filter = null;
        askViewBy(response,convo);
        convo.next()
      }
      else{
        filter.field = response.text;
        askFilterDetails(response, convo);
        convo.next();
      }
    });
    }
  });
}

askFilterDetails = function(response, convo){
  var query = connection.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + queryOptions.table + "' AND COLUMN_NAME = '" + filter.field + "'");
  query.on('error', function(err) {
    throw err;
      console.log('weeeooooweeeeoooo error');
  });
  query.on('result', function(row) {
    console.log('filterquery2 running');
    var filterDataType = row['DATA_TYPE'];
    var options = {
      "varchar" : "`Is`, `Is Not`, `Is Empty`, `Not Empty`",
      "float" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`",
      "tinyint" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`",
      "int" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`",
      "timestamp" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`",
      "date" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`",
      "datetime" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`",

    };

    convo.ask("What would you like to filter by? \n" + options[row['DATA_TYPE']], function(response, convo){

      //add filter details to filter object
      filter.filter = response.text;
      filter.dataType = filterDataType;
      console.log(filter);
      //add filter to queryOptions object
      queryOptions.filter = filter;
      askViewBy(response, convo);
      convo.next();
    });
  });
}

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
            connection.query({ sql : query, timeout : 10000 }, function(error, results, fields){
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
          connection.query({ sql : query, timeout : 10000 }, function(error, results, fields){
            console.log(results);
            var key = 'count(*)';
            var count = results[0][key];
            console.log(count);
            //if there is a filter, include it in the response
            if (queryOptions.filter != null){
              convo.say("There have been *" + count + " " + queryOptions.table + "* " + queryOptions.filter.filter.toLowerCase());
            }
            else{
              convo.say("There are *" + count + " " + queryOptions.table + "* ");
            }
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
            connection.query({ sql : query, timeout : 10000 }, function(error, results, fields){
              console.log(results);
              var key = 'sum(`' + view.field + '`)';
              var sum = results[0][key];
              console.log(sum);
              convo.say("Sum: " + sum);
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

function buildQuery(){

  console.log("Building Query: ", queryOptions);

  var table = queryOptions.table;
  var viewType = queryOptions.view.type;


  //set filter if there is one
  if(queryOptions.filter != null){
    var filter = queryOptions.filter.filter;
    var field = queryOptions.filter.field;
    var filterDataType = queryOptions.filter.dataType;
  }

  //set where statement based off of filter + field
  if (filter == "Today"){
    if (filterDataType == "timestamp"){
      var whereStatement = field + " >= CURDATE()";
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "Yesterday"){
    if (filterDataType == "timestamp"){
      var whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND " + field + " < CURDATE()"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "Past 7 days"){
    if (filterDataType == "timestamp"){
      var whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND " + field + " < CURDATE()"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "Past 30 days"){
    if (filterDataType == "timestamp"){
      var whereStatement =  field + " >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND " + field + " < CURDATE()"
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "Last Week"){
    if (filterDataType == "timestamp"){
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }
  else if (filter == "Last Month"){
    if (filterDataType == "timestamp"){
      var whereStatement =  "YEAR(" + field + ") = YEAR(CURRENT_DATE - INTERVAL 1 MONTH) AND MONTH(" + field + ") = MONTH(CURRENT_DATE - INTERVAL 1 MONTH)"
      console.log(whereStatement);
    }
    else if (filterDataType == "date"){
      //do something
    }
    else if (filterDataType == "datetime"){
      //do something
    }
  }



  if (viewType == "count"){
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
