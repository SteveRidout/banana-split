"use strict";

var mongoose = require('mongoose');

module.exports = function (options) {
	var experimentSchema = new options.mongoose.Schema({
		name: {type: String, unique: true},
		variations: [{
			name: String,
			participants: Number,
			conversions: Number
		}],
		lastCalculated: Date       // used to check that we're up to date
	});

	experimentSchema.index({name: 1});

	return options.db.model('Experiment', experimentSchema);
};

