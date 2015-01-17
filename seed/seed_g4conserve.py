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
collect = db.mrna
tax_collect = db.taxon
#------------------------------------------------------------


if len(sys.argv) == 3 :
  taxon_ids = sys.argv[1:]
else :
    print("You must specify a principal and comparison taxon id")
    sys.exit(0);

ptax = sys.argv[1];
ctax = sys.argv[2];

spec = { 'id' : ptax}
record = tax_collect.find_one(spec);
p_organism = record['scientific name'];

spec = { 'id' : ctax}
record = tax_collect.find_one(spec);
c_organism = record['scientific name'];

print("Computing conservation between ", p_organism , "and", c_organism)

def process_mrna(count, mrna, start_time):
    url = seq_url + '/homologene/mrna/' + mrna['accession']
    response = requests.get(url)
    if response.status_code == requests.codes.ok :
        data = response.json()

    if len(data) > 0 :
        comparisons = [ h['mrna_accession_ver'] for h in data[0]['homologs'] if h['tax_name']==c_organism]
        if  len(comparisons) > 0 :
            pa = mrna['accession'];
            ca = comparisons[0];
            url = seq_url + '/g4/mrna/' + pa + '/' + ca + '/cmap?downstream=200'
            response = requests.get(url)
            if response.status_code == requests.codes.ok :
                data = response.json()
                c_count = 0
                g_count = 0
                for g4 in data['principal']['g4s']:
                    g_count += 1
                    if 'best_conserved_rep' in g4 :
                        c_count += 1

                        #  Next step, plug the best_conserved_ref (without comparison gap)
                        #  into a conservation array in the g4 in the DB and save!

                print( '{0: <15}'.format(mrna['accession']), " x ", '{0: <15}'.format(comparisons[0]), ' mapped ', c_count , 'conserved motifs of ', g_count)

start = time.time()
mcursor = collect.find(spec={'organism':p_organism},snapshot=True, timeout=False)
count = 1
for record in mcursor:
    if process_mrna(count, record, start):
        count += 1
mcursor.close()

print ('Processed ', count, " mRNA ->  G4 Conservation Seeding Complete")
