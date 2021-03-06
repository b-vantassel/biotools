var db = require("../db");
var async = require('async');
var core_routes = require('./index');
var _ = require('underscore');

var qgrs_module = require('qgrs');
var qgrs_version = require('qgrs/package.json').version;


function makeFilter(req){
    var p_minTetrad = req.body.minTetrad || req.query.minTetrad || 2;
    var p_maxTetrad = req.body.maxTetrad || req.query.maxTetrad || Number.MAX_VALUE; // unlikely...
    var p_minGScore = req.body.minGScore || req.query.minGScore || 13;
    var p_maxGScore = req.body.maxGScore || req.query.maxGScore || Number.MAX_VALUE;
    var p_minLength = req.body.minLength || req.query.minLength || p_minTetrad * 4;
    var p_maxLength = req.body.maxLength || req.query.maxLength || Number.MAX_VALUE;

    var filter = {
        minTetrad : p_minTetrad,
        maxTetrad : p_maxTetrad,
        minGScore : p_minGScore,
        maxGScore : p_maxGScore,
        maxLength : p_maxLength,
        minLength : p_minLength,
        apply : function(g4)  {
            return (g4.tetrads >= p_minTetrad && g4.tetrads <= p_maxTetrad &&
                g4.gscore >= p_minGScore && g4.gscore <= p_maxGScore &&
                g4.length >= p_minLength && g4.length <= p_maxLength);
        }
    }
    return filter;
}

exports.makeQgrsFilter = makeFilter;


exports.record = function(req, res) {
  var page = {
    qgrs : {
      id : req.params.g4id
    }
  };
  res.render("qgrs/record", page);
}



exports.qgrs = function(req, res){
    var g4id = req.params.g4id;
    var g4;
    var splits = g4id.split(".");
    splits.pop();
    var accession = splits.join(".");
    db.mrna.findOne({ accession : accession}, function(err, mrna){
        if ( err || !mrna) {
            res.status(404).end('mRNA could not be found');
        }
        else {
            g4 = mrna.g4s.filter(function (g4) {
                return g4.id == g4id;
            })[0];
            if ( !g4 ) {
                res.status(404).end('QGRS could not be found');
            }
            else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(g4));
            }
        }
    });

}
exports.qgrs_overlaps = function(req, res){
    var filter = makeFilter(req);
    var g4id = req.params.g4id;
    var g4;
    var g4_record;
    var g4_start;


    async.waterfall([
        function(callback){
            // find the associated mrna (splice the g4_id)
            var splits = g4id.split(".");
            splits.pop();
            var accession = splits.join(".");
            db.mrna.findOne({ accession : accession}, function(err, mrna){
                if ( err ) {
                    callback(err, null);
                }
                else {
                    callback(null, mrna);
                }
            });
        },
        function(mrna, callback){
            if ( !mrna || !mrna.g4s) {
              callback("The given mRNA does not have any G4 motifs", null);
              return;
            }
            g4 = mrna.g4s.filter(function (g4) {
                return g4.id == g4id;
            })[0];

            if ( !g4 ) {
              callback("The given mRNA (" + mrna.accession + ") does not have any G4 motifs with id = " + g4id, null);
              return
            }
            g4_start = g4.range.start;

            downstream = g4.isDownstream ? 200 : 0;
            g4_record = g4;
            core_routes.build_mrna_sequence(mrna.accession, downstream,
                function(err) {
                    res.status(404).end('mRNA sequence data could not be found');
                },
                function(mrna, sequence) {
                    callback(null, sequence.substring(g4.range.start, g4.range.end));
                });
        },
        function(sequence, callback){
            result = qgrs_module.find(sequence);
            callback(null, JSON.parse(result).results);
        },
        function(g4s, callback){
            var g = g4s[0];
            g.overlaps = g.overlaps.filter(filter.apply);
            g.overlaps.forEach(function (o) {
              // overlaps are relative to the start position of the parent
              o.start+= g4_start;
              o.tetrad1 += g4_start;
              o.tetrad2 += g4_start;
              o.tetrad3 += g4_start;
              o.tetrad4 += g4_start;
            });
            callback(null, g);
        }
    ], function (err, g4) {
        if ( err ) {
            res.status(404).end('mRNA could not be found');
        }
        else {
            res.setHeader('Content-Type', 'application/json');
            g4_record.overlaps = g4.overlaps;
            res.end(JSON.stringify(g4_record));
        }
    });
}


function merge_range_set (ranges, new_range, clip) {

    if ( clip && clip.start && new_range.start < clip.start) {
      new_range.start = clip.start;
    }
    if ( clip && clip.end && new_range.end > clip.end) {
      new_range.end = clip.end;
    }

    for ( var i = 0; i < ranges.length; i++ ) {
        r = ranges[i];
        if ( new_range.start >= r.start && new_range.start <= r.end ) {
            // starts within a range... see if we should extend this range
            if ( new_range.end > r.end ) {
                r.end = new_range.end;
            }
            return;
        }
        else if ( new_range.end >= r.start && new_range.end <= r.end) {
            // ends within a range, see if we should extend this range
            if ( new_range.start < r.start ) {
                r.start = new_range.start;
            }
            return;
        }
    }
    ranges.push(new_range);
}

exports.input = function(req, res) {
    res.render("qgrs/input", {});
}

exports.qgrs_mrna = function(req, res) {
  var accession = req.params.accession;
  var downstream = parseInt(req.query.downstream || 0);
  var error = false;
  core_routes.build_mrna_sequence(accession, downstream,
      function(err) {
          error = true;
          res.status(404).end('mRNA sequence data could not be found');
          return;
      },
      function(mrna, sequence, downstream_included) {
        if ( !error) {
          var output = {
            time : new Date(),
            qgrs_map_version : qgrs_version,
            accession : accession,
            sequence: sequence,
            downstream:downstream_included,
            result : ""
          }
          var r = JSON.parse(qgrs_module.find(sequence));
          output.result = r.results;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(output));
        }
      });
}

exports.qgrs_find = function (req, res) {
  var sequence = req.body.sequence;
  var output = {
    time : new Date(),
    qgrs_map_version : qgrs_version,
    input : sequence,
    result : ""
  }
  var r = JSON.parse(qgrs_module.find(sequence));
  output.result = r.results;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(output));
}

function computeTotal(first_pass_ranges) {
    var ranges = [];
    for ( var i = 0; i < first_pass_ranges.length; i++ ) {
      merge_range_set(ranges, first_pass_ranges[i]);
    }

    var total = 0;
    for ( var i = 0; i < ranges.length; i++ ) {
        r = ranges[i];
        total += r.end-r.start;
    }
    return total;
}






exports.qgrs_enrichment = function(req, res) {
  res.render("qgrs/enrichment");
}

exports.qgrs_enrichment_analysis = function(req, res) {
  var query = core_routes.build_mrna_query(req, [{g4s : {'$exists' : true}}, {u_rich_downstream : {'$exists':true}}]);
  var base_g_filter = makeFilter(req);

  var job = new db.jobs ( {
      type : "QGRS Enrichment Analysis",
      progress: 0,
      status: "Starting",
      complete: false,
      error : false,
      error_message: "",
      date : new Date(),
      query : { 'qgrs' : base_g_filter},
      owner : "scott.frees@gmail.com",
  });
  job.save(function (saved) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(job));
  });


  var total_to_be_processed = 0
  var status_increment = 100000;

  db.mrna.count(query, function (err, doc){
    total_to_be_processed = parseInt(doc);
    status_increment = Math.floor(total_to_be_processed / 100);
  });

  var stream = db.mrna.find(query).stream();
  var mrna_count = 0;
  var all_den = 0, utr5_den = 0, cds_den = 0, utr3_den = 0, downstream_den = 0;
  var all_total = 0, utr5_total = 0, cds_total = 0, utr3_total = 0, downstream_total = 0;
  var all_count = 0, utr5_count = 0, cds_count = 0, utr3_count = 0, downstream_count = 0;

  stream.on('data', function (doc) {
    var g4s = doc.g4s.filter(base_g_filter.apply);

    var d = calc_density(doc, base_g_filter, 200, g4s);
    all_den += d.density.overall.density;
    all_total += d.density.overall.total;
    all_count++;
    if ( d.density.utr5.length > 0 ) {
      utr5_den += d.density.utr5.density;
      utr5_total += d.density.utr5.total;
      utr5_count++;
    }
    if ( d.density.cds.length > 0 ) {
      cds_den += d.density.cds.density;
      cds_total += d.density.cds.total;
      cds_count++;
    }
    if ( d.density.utr3.length > 0 ) {
      utr3_den += d.density.utr3.density;
      utr3_total += d.density.utr3.total;
      utr3_count++;
    }
    downstream_den += d.density.downstream.density;
    downstream_total += d.density.downstream.total;
    downstream_count++;


    if ( mrna_count % status_increment == 0 ) {
      if ( total_to_be_processed == 0 ) {
        job.progress = 0;
      }
      else {
          job.progress = mrna_count / total_to_be_processed;
      }
      job.status = "Processed " + mrna_count + " mRNA of " + total_to_be_processed;
      job.save();
    }

    mrna_count++;
  });

  stream.on('close', function() {
    job.progress = 100;
    job.status = "Analysis Complete";
    job.complete = true;

    job.result  = {
      mrna_count : total_to_be_processed,
      avg_density : {
          all : all_den / all_count,
          utr5 : utr5_den / utr5_count,
          cds : cds_den / cds_count,
          utr3 : utr3_den / utr3_count,
          downstream : downstream_den / downstream_count
      },
      counts :{
        all : all_count,
        utr5 : utr5_count,
        cds : cds_count,
        utr3 : utr3_count,
        downstream : downstream_count
      },
      totals :{
        all : all_total,
        utr5 : utr5_total,
        cds : cds_total,
        utr3 : utr3_total,
        downstream : downstream_total
      }
    }
    job.save();
  });

  stream.on('error', function(err) {
    job.progress = 0;
    job.status = "Analysis Failed";
    job.error = true;
    job.complete = false;
    job.error_message = JSON.stringify(err);
    job.save();
  });

}





function calc_density(parent_mrna, filter, downstream, g4s) {
  var cds_start = parent_mrna.cds.start;
  var cds_end = parent_mrna.cds.end
  var transcript_end = parent_mrna.length;

  var in3 = function(g4) {
    g4.end = g4.start+g4.length;
    return g4.start >= cds_end && g4.start <= transcript_end || g4.end >= cds_end && g4.end <= transcript_end
  }
  var in5 = function (g4) {
    g4.end = g4.start+g4.length;
    return g4.start <= cds_start;
  }
  var inCds = function(g4) {
    g4.end = g4.start+g4.length;
    return g4.start >= cds_start && g4.start <= cds_end || g4.end >= cds_start && g4.end <= cds_end
  }
  var inDown = function(g4) {
    g4.end = g4.start+g4.length;
    return g4.end >= transcript_end
  }

  var any = [];
  var u3 = [];
  var u5 = [];
  var cds = [];
  var down = [];

  var process_motif = function (g4) {
      var in_any = false, in_5utr = false, in_3utr = false, in_cds = false, in_downstream = false;
      if ( filter.apply(g4)) {
          if ( in3(g4)|| in5(g4) || inCds(g4)) in_any = true;
          if ( in3(g4) ) in_3utr = true;
          if ( in5(g4) ) in_5utr = true;
          if ( inCds(g4) ) in_cds= true;
          if ( inDown(g4)) in_downstream = true;
      }
      if (in_any) merge_range_set(any, {start: g4.start, end: g4.start+g4.length});
      if (in_5utr) merge_range_set(u5, {start: g4.start, end: g4.start+g4.length}, {start : 0, end : cds_start});
      if (in_3utr) merge_range_set(u3, {start: g4.start, end: g4.start+g4.length}, {start : cds_end, end : transcript_end});
      if (in_cds) merge_range_set(cds, {start: g4.start, end: g4.start+g4.length}, {start : cds_start, end : cds_end})
      if (in_downstream) merge_range_set(down, {start: g4.start, end: g4.start+g4.length}, {start : transcript_end})
  }

  for ( i in g4s ) {
      g4 = g4s[i];
      process_motif(g4);
      for ( j in g4s[i].overlaps) {
          g4 = g4s[i].overlaps[j];
          process_motif(g4);
      }
  }
  var total = computeTotal(any);
  var total_5utr = computeTotal(u5);
  var total_cds = computeTotal(cds);
  var total_3utr = computeTotal(u3);
  var total_downstream = computeTotal(down);

  var overall_length = parent_mrna.length;
  var utr5_length = parent_mrna.cds.start;
  var utr3_length = parent_mrna.length - parent_mrna.cds.end;
  var cds_length = parent_mrna.cds.end - parent_mrna.cds.start;

  var d_result = {
      density_criteria : filter,
      accession : parent_mrna.accession,
      build : parent_mrna.build,
      cds : parent_mrna.cds,
      density : {
          overall : {
              total : total,
              length : overall_length,
              density : total / overall_length
          },
          utr3 : {
              total : total_3utr,
              length : utr3_length,
              density : total_3utr / utr3_length
          },
          cds : {
              total : total_cds,
              length : cds_length,
              density : total_cds / cds_length
          },
          utr5 : {
              total : total_5utr,
              length : utr5_length,
              density : total_5utr / utr5_length
          },
          downstream : {
              total : total_downstream,
              length : downstream,
              density : total_downstream / downstream
          }
      }

  }
  return d_result;
}


// Performs deep analysis - overlaps are re-mapped with C++ module
exports.qgrs_density = function(req, res) {
    var filter = makeFilter(req);
    var accession = req.params.accession;
    var parent_mrna;
    var downstream = 200;

    async.waterfall([
        function(callback){
            // now grab the entire sequence, along with some downstream data.
            core_routes.build_mrna_sequence(accession, downstream,
                function(err) {
                    res.status(404).end('mRNA sequence data could not be found');
                },
                function(mrna, sequence) {
                    parent_mrna = mrna;
                    callback(null, sequence);
                });
        },
        function(sequence, callback){
          result = JSON.parse(qgrs_module.find(sequence));
          callback(null, result.results);
        },
        function(g4s, callback){
            d_result = calc_density(parent_mrna, filter, downstream, g4s);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(d_result));

        }
    ]);
}
