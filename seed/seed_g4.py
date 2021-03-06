import configparser
import urllib.request
import shutil
import os
import numpy as np
import re
import requests
import sys
import time

sys.path.append("../util")
import g

skip_existing = False


config = configparser.ConfigParser()
config.read('seed_sources.ini')

#------------------------------------------------------------
# Note:     This seeding script requires the chromosome sequence
#           service to be up and running, with a fully populated
#           sequence database.  Use the URL field below to direct
#           the script to an alternative endpoint for sequence
#           data.
#
#           mRNA listings are pulled directly from the mrna collection
#           in mongo.
seq_url = config['chrom']['serve_url']
#------------------------------------------------------------

# Controls how far into the downstream region (past poly(A)) we will
# map G4 into.
downstream = int(config['g4']['downstream'])

#------------------------------------------------------------
# MongoDB configuration / initialization
from pymongo import MongoClient
client = MongoClient()
db = client[config['db']['name']]
collect = db[config['g4']['collection']]
#------------------------------------------------------------

def valid_position(s):
    try:
        return int(s)
    except ValueError:
        return -1

def findRange(g4):
    retval = dict()
    retval['start'] = g4['start'];
    retval['end']= g4['start'] + g4['length'];

    if 'overlaps' not in g4 :
        return retval;

    for o in g4['overlaps'] :
        if o['start'] < retval['start']:
            retval['start'] = o['start'];

        end = o['start']+o['length']
        if end > retval['end']:
            retval['end'] = end;

    return retval;

def process_mrna(count, mrna, start_time):
    url = seq_url + '/qgrs/mrna/' + mrna['accession'] + '/map?downstream=200'
    #if 'length' not in mrna :  #added by the features script - with cds
    #    print("Skipping, no length")
    #    return False
    #if 'cds' not in mrna :
    #    print("Skipping, no cds")
    #    return False
    #if valid_position(mrna['cds']['start']) < 0 :
    #    print("Skipping, bad cds start")
    #    return False
    #if valid_position(mrna['cds']['end']) < 0 :
    #    print("Skipping, bad cds end")
    #    return False
    if 'g4s' in mrna and skip_existing:
        print('Skipping ', mrna['accession'], " - g4s already exist")
        return True


    #end = int(mrna['length'])
    time_sum = 0
    before = time.time()
    response = requests.get(url)
    if response.status_code == requests.codes.ok :
        data = response.json()
        if  'result' in data:
            g4s = data['result'];

            g4_list = list()
            # Now annotate all the G4 based on region [Promoter, 5'UTR, CDS, 3'UTR, Downstream, Intron]
            # For now we are not doing promoter or intron
            id = 1
            for g4 in g4s :
                g4['id'] = mrna['accession'] + '.' + str(id)
                #cds_start = int(mrna['cds']['start'])
                #cds_end = int(mrna['cds']['end'])
                #g4_start = int(g4['start'])
                #g4_end = g4_start + int(g4['length'])
                #g4['is5Prime'] = g4_start <= cds_start
                #g4['isCDS'] = g4_start >= cds_start and g4_start <= cds_end or g4_end >= cds_start and g4_end <= cds_end
                #g4['is3Prime'] = g4_start >= cds_end and g4_start <= end or g4_end >= cds_end and g4_end <= end
                #g4['isDownstream'] = g4_end >= end

                # we won't put the overlaps in the database
                g4['range'] = findRange(g4);
                g4.pop("overlaps", None);

                g4_list.append(g4)
                id += 1;

            collect.update({'_id':mrna['_id']}, {'$set': {'g4s': g4_list}})


            after = time.time()
            time_avg = (after-start_time) / count
            print ("Processed ", '{0: <15}'.format(mrna['accession']), "  ->  ", '{0: <5}'.format(str(len(g4s))), " G4s found, in " , '{0:.4f}'.format(after-before), " secs (count = ", '{0:<9}'.format(count), "avg = " , '{0:.4f}'.format(time_avg), " secs)")
            return True
        else:
            return False

start = time.time()
mcursor = collect.find(filter={}, modifiers={"$snapshot": True}, no_cursor_timeout=True)
count = 1
for record in mcursor:
    if process_mrna(count, record, start):
        count += 1
mcursor.close()
print ('Processed ', count, " mRNA ->  G4 Seeding Complete")
