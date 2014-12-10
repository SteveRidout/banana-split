"use strict";

var mongoose = require('mongoose');

module.exports = function (db) {
	var participationSchema = new mongoose.Schema({
		experiment:  String,
		participant: String,                         // unique ID for participant
		
		variation:   String,
		converted:   Boolean
	});

	participationSchema.index({experimentID: 1, userID: 1});
	participationSchema.index({experimentID: 1, variation: 1});

	return db.model('Participation', participationSchema);
};

