var mongoose = exports.mongoose = require ("mongoose");
var url = "mongodb://localhost:27017/chrome";
var fs = require('fs');

var mongoose = exports.mongoose = require ("mongoose");

mongoose.connect(url, { auto_reconnect: true }, function (err, res) {
  if (err) {
    console.log ('ERROR connecting to: ' + url + '. ' + err);
  } else {
    init(mongoose);
    exports.db = res;
    exports.mongoose = mongoose;
    console.log("Connected to mongo instance at " + url)
  }
});



var init = function init(mongoose) {
    createSeqSchema(mongoose);
    createGeneSchema(mongoose);
    createMrnaSchema(mongoose);
    createHomologeneSchema(mongoose);
    createJobsSchema(mongoose);
};

var seq;
var page_size = 10000;
var zlib = require('zlib');
var async = require('async');


function compare_ranges(a,b) {
  if (a.start < b.start)
     return -1;
  if (a.start > b.start)
    return 1;
  return 0;
}

exports.getSequence = function(accession, start, end, final_callback) {

  // QUICK HACK - RESOLVE ACCESSION SYNONYM

    var synonyms = {
      NT_187005: 'NC_000083'
    }
    if ( synonyms[accession] ) {
      accession = synonyms[accession];
    }

    var init_start = start;
    var init_end = end;
    if ( start < 0 || end < start) {
        final_callback('Nucleotide region specified is an invalid range', null)
        return;
    }
    if ( start == end ) {

        final_callback(null,
        {
            accession : accession,
            start : init_start,
            end : init_end,
            description : '-',
            seq : ''
        })
        return;
    }
    var ranges = [];
    var processed_ranges = [];
    do {
        var start_page = page_num (start);
        var end_page = page_num (end);
        if ( start_page == end_page ) {
            ranges.push ({ start : start, end : end} )
        }
        else {
            var next_start = (start_page+1)*page_size
            ranges.push({start : start, end : next_start});
            start = next_start;
        }
    } while ( start_page != end_page)

    var error = false; // flag so we don't call the error callback multiple times
    async.each(ranges,
        function(range, callback) {
            getSequenceFromPage(accession, range.start, range.end, function( err, page_seq) {
                if ( err || !page_seq) {
                    callback('Page not found');
                    return;
                }
                processed_ranges.push ( {start : range.start, end : range.end, seq : page_seq.seq});
                callback();
            });
        }, function (err) {
            if ( err ) {
              if ( !error) {
                error = true;
                final_callback(err);
              }

            }

            if ( processed_ranges.length == 0 ) {
                if ( !error) {
                  error = true;
                  final_callback('No sequence data found');
                }

                return;
            }

            processed_ranges.sort(compare_ranges);
            var retval = "";
            for ( i = 0; i < processed_ranges.length; i++ ) {
                if ( processed_ranges[i].seq )
                    retval += processed_ranges[i].seq;
                else {
                    if ( !error) {
                      error = true;
                      final_callback("Range was invalid", null);
                    }

                }
            }
            final_callback(null,
                {
                    accession : accession,
                    start : init_start,
                    end : init_end,
                    description : processed_ranges[0].description,
                    seq : retval
                });
        }
    );
}

function getSequenceFromPage(accession, start, end, callback) {
    var page_start = page_num(start) * page_size;
    seq.findOne({accession:accession, start : page_start}, function(err, page) {
        if ( err ) {
            callback(err);
            return;
        }
        if ( page ) {
            zlib.inflate(page.seq, function(err, result) {
                if ( err ) {
                    callback(err);
                }
                var retval = result.toString('ascii');
                var mod_start = start - page_start;
                var mod_end = end - page_start;
                retval = retval.substring(mod_start, mod_end);
                callback(null, { accession: page.accession, description : page.description, seq : retval});
            })
        }
        else {
            callback('No sequence data');
        }

    });
}

function page_num(position) {
    var page = Math.floor(position/page_size);
    return page;
}

function createSeqSchema(mongoose) {

    var schem = new mongoose.Schema({
        accession : String,
            start: Number,
            end: Number,
            seq: Buffer,
            description : String
        }, {collection:'seq'});



    exports.seq = mongoose.model('Seq', schem);
    seq = exports.seq;
}

function createJobsSchema(mongoose) {

    var schem = new mongoose.Schema({
        type : String,
            progress: Number,
            status: String,
            complete: Boolean,
            error : Boolean,
            error_message: String,
            date : Date,
            owner : String,
            query : mongoose.Schema.Types.Mixed,
            result : mongoose.Schema.Types.Mixed
        }, {collection:'jobs'});



    exports.jobs = mongoose.model('Jobs', schem);
    jobs = exports.jobs;
}


function createHomologeneSchema(mongoose) {

    var schem = new mongoose.Schema({
        hid : String,
        homologs : [
            {
                tax_id : String,
                protein_length : Number,
                end : Number,
                start : Number,
                gene_symbol : String,
                mrna_accession_ver : String,
                gi_source : String,
                gene_id : String,
                protein_gi : String,
                tax_name : String,
                protein_accession : String,
                strand : String
            }
        ]
        }, {collection:'homologene'});



    exports.homologene = mongoose.model('Homologene', schem);
    homologene = exports.homologene;
}

function createGeneSchema(mongoose) {
    var schem = new mongoose.Schema({
            gene_name : String,
            start: Number,
            end: Number,
            gene_id: String,
            chrom : String
        }, {collection:'gene'});
    exports.gene = mongoose.model('Gene', schem);
}

function createMrnaSchema(mongoose) {
    var schem = new mongoose.Schema({
            accession : String,
            start: Number,
            end: Number,
            gene_id: String,
            chrom : String,
            orientation : String,
            exons : [ { start : Number, end : Number} ],
            cds : { start : Number, end : Number},
            utr_3 : { start : Number, end : Number},
            utr_5 : { start : Number, end : Number},
            organism : String,
            definition : String,
            length : Number,
            gene_name : String,
            u_rich_downstream : [
                {
                    downstream_rel_pos : Number,
                    seq : String,
                    order : Number
                }
            ],
            g4s : [
                {
                    id : String,
                    gscore : Number,
                    start : Number,
                    is5Prime : Boolean,
                    isCDS : Boolean,
                    is3Prime : Boolean,
                    isDownstream : Boolean,
                    tetrads : Number,
                    tetrad1: Number,
                    tetrad2 : Number,
                    tetrad3: Number,
                    tetrad4: Number,
                    y1: Number,
                    y2 : Number,
                    y3 : Number,
                    sequence: String,
                    length : Number,
                    range : {
                        start : Number,
                        end : Number
                    },
                    overlaps : [
                        {
                            id : String,
                            gscore : Number,
                            start : Number,
                            is5Prime : Boolean,
                            isCDS : Boolean,
                            is3Prime : Boolean,
                            isDownstream : Boolean,
                            tetrads : Number,
                            tetrad1: Number,
                            tetrad2 : Number,
                            tetrad3: Number,
                            tetrad4: Number,
                            y1: Number,
                            y2 : Number,
                            y3 : Number,
                            sequence: String,
                            length : Number
                        }
                    ]
                }
            ]
        }, {collection:'mrna'});
    exports.mrna = mongoose.model('mRNA', schem);
}
