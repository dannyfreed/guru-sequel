var request = require('request');
var fs = require('fs');
var csvWriter = require('csv-write-stream');

var writer = csvWriter();
var token = "xoxp-17426907188-18992194192-20808646791-3e978f796d";


var filename = 'test123.csv';
var writer = csvWriter({ headers: ["hello", "foo"]})
writer.pipe(fs.createWriteStream(filename))
writer.write(['world', 'bar'])
writer.end()

var options = {
	mode: "text",
	args: [filename]
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





