/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('Botkit');
var mysql = require('mysql');
var Promise = require('promise');
var request = require('request');
var fs = require('fs');

var csvWriter = require('csv-write-stream');


var token = "xoxp-17426907188-18992194192-20808646791-3e978f796d";
var PythonShell = require('python-shell');



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

  convo.say("Ok. I've got your list of *" + selectedTable + "* right here. Would you like to apply any filters to narrow your search?");

  //get column titles of specified table, put into columns[]
  connection.query('SHOW COLUMNS FROM ' + selectedTable +';', function(err, rows, fields) {
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
      filter.field = response.text;
      askFilterDetails(response, convo);
      convo.next();
    });
  }
});
}

askFilterDetails = function(response, convo){
  var query = connection.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + queryOptions.table + "' AND COLUMN_NAME = '" + filter.field + "'");
  query.on('error', function(err) {
    throw err;
  });
  query.on('result', function(row) {
    var options = {
      "varchar" : "`Is`, `Is Not`, `Is Empty`, `Not Empty`, `None`",
      "float" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
      "tinyint" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
      "int" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
      "timestamp" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`, `None`",
      "time" : "`TO DO.....:tophat:`"
    };

    convo.ask("What would you like to filter by? \n" + options[row['DATA_TYPE']], function(response, convo){

      //add filter details to filter object
      filter.filter = response.text;
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
      var filePath = null;
          //convo.next();
          console.log(queryOptions);
          var today = new Date();
          var dd = today.getDate();
            var mm = today.getMonth()+1; //January is 0!
            var yyyy = today.getFullYear();

            var filename = queryOptions.table + "_" + queryOptions.filter.filter + "_" + mm + "_" + dd + "_" + yyyy;        

            var query = "SELECT * FROM orders";
            connection.query({ sql : query, timeout : 10000 }, function(error, results, fields){
             var keys = Object.keys(results[0])
             var writer = csvWriter({ headers: keys})
             writer.pipe(fs.createWriteStream(filename));
             for(i=0; i<results.length; i++){
              var vals = [];
              for(j=0; j<keys.length; j++){
                vals.push(results[i][keys[j]]);
              }
              writer.write(vals);
            }
            writer.end()
          });



  

var promise = new Promise(function (resolve, reject){

      var options = {mode: "text", args: [filename, token] };

    PythonShell.run('upload.py', options, function (err, results) { 
  if(err){
    console.log(err);
    reject(err);
  }
  else{

                            var attachment = [];
                            var attach=            
                            {
                              "fallback": "Data Results...",
                              "pretext": "Attached are your results",
                              "title": "SQL Results",
                              "title_link": results[0],
                              "text": "Data Attachment.",
                              "color": "#7CD197"
                            };
                            attachment.push(attach);
                            console.log(attachment);
                      console.log("in func", results[0]);
                      resolve(results[0]);
      }
    });
});

promise.then(function (data){
  console.log("in prom", data);
})

//convo.next();


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
  }

  //set where statement based off of filter + field
  if (filter == "Today"){
    var whereStatement = field + " >= CURDATE()";
  }
  else if (filter == "Yesterday"){
    //build these scenarios out
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
