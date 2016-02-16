from slacker import Slacker
import pdb 
import sys 
import json 
import os 

filename = sys.argv[1]
token = sys.argv[2]
slack = Slacker(token)
response = slack.files.upload(filename)
print(response.body['file']['permalink_public'])

try:
	os.remove(filename)
except:
	print("Error")
sys.stdout.flush()
