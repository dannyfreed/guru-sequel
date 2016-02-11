var fs = require('fs');
var csvWriter = require('csv-write-stream');
var mysql = require("mysql");
var writer = csvWriter();
var token = "xoxp-17426907188-18992194192-20808646791-3e978f796d";

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


var filename = "testQuery3.csv";
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


var options = {
	mode: "text",
	args: [filename, token]
};

var PythonShell = require('python-shell');
PythonShell.run('upload.py', options, function (err, results) { 
	if(err){
		console.log(err);
	}
	else{
		console.log(results);
	}
});





