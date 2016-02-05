/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('Botkit');
var mysql = require('mysql');

require('./env.js');

if (!process.env.clientId || !process.env.clientSecret || !process.env.port) {
  console.log('Error: Specify clientId clientSecret and port in environment');
  process.exit(1);
}


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

  //global variable so we can use it in other functions
  connection = mysql.createConnection({
  	host     : host,
  	user     : username,
  	password : password,
  	database : database
  });
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

controller.hears(['question'],['direct_message','direct_mention','mention'],function(bot,message) {
	bot.reply(message, "What do you have a question about?");
	bot.startConversation(message, askTable);
});

choices = [];

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
			choices.push(response.text);
      console.log(choices)
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
			}

    //list column titles, ask user to select one
		convo.ask(columns.toString(), function(response, convo){
			choices.push(response.text);
      console.log(choices);
			askFilterDetails(response, convo);
			convo.next();
		});
		}
	});
}


askFilterDetails = function(response, convo){

  console.log(selectedTable);

	var query = connection.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '" + choices[0] + "' AND COLUMN_NAME = '" + choices[1] + "'");
	query.on('error', function(err) {
		throw err;
	});
	query.on('result', function(row) {
		var options = {
			"varchar" : "`Is`, `Is Not`, `Is Empty`, `Not Empty`, `None`",
			"float" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
			"tinyint" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
			"int" : "`Equal`, `Not Equal`, `Greater Than`, `Less Than`, `Is Empty`, `Not Empty`, `None`",
			"date" : "`Today`, `Yesterday`, `Past 7 Days`, `Past 30 Days`, `Last Week`, `Last Month`, `Last Year`, `This Week`, `This Month`, `This Year`, `None`",
			"time" : "`TO DO.....:tophat:`"
		};

		convo.ask("What would you like to filter by? \n" + options[row['DATA_TYPE']], function(response, convo){
			choices.push(response.text);
      console.log(choices);
			askViewBy(response, convo);
			convo.next();
		});
	});
}

askViewBy = function(response, convo){
	convo.ask("What would you like to view by? \n `Raw Data`, `Count`, `Average`, `Sum`", function(response, convo){
		choices.push(response.text);
		makeSQL();
		convo.next();
	});
}

makeSQL = function(response, convo){
	console.log("query", choices);

	if(choices[2] == "None"){
    console.log('woot1');
		var query = "SELECT " + choices[1]  + " FROM " + choices[0];
	}
	else{
    console.log('woot2');
		var query = "SELECT " + choices[1]  + " FROM " + choices[0] + "WHERE" + choices[1] + " " + choices[2] + " STRINGGGGG";
	}

	connection.query({
		sql : query,
		timeout : 4000000
	},
  function(error, results, fields){
    for(var i = 0; i < results.length; i++){
			var keys = Object.keys(results[i]);
			for(var j = 0; j < keys.length; j++){
  			//CONVO undefined???
        console.log(results);
  			console.log(results[i][keys[j]]);
  		}
    }
  });
}

// controller.on(['direct_message','mention','direct_mention'],function(bot,message) {
//   bot.api.reactions.add({
//     timestamp: message.ts,
//     channel: message.channel,
//     name: 'robot_face',
//   },function(err) {
//     if (err) { console.log(err) }
//     bot.reply(message,'I heard you loud and clear boss.');
//   });
// });

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
