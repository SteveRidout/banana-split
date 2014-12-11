"use strict";

var mongoose = require('mongoose');

module.exports = function (db) {
	var experimentSchema = new mongoose.Schema({
		name: {type: String, unique: true},
		variations: [{
			name: String,
			participants: Number,
			conversions: Number
		}],
		lastCalculated: Date       // used to check that we're up to date
	});

	experimentSchema.index({name: 1});

	return db.model('Experiment', experimentSchema);
};

