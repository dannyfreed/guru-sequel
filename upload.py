from slacker import Slacker
import pdb 
import sys 
import json 

filename = sys.argv[1]
slack = Slacker('xoxp-17426907188-18992194192-20808646791-3e978f796d')
response = slack.files.upload(filename)
print(response.body['file']['permalink'])

sys.stdout.flush()
