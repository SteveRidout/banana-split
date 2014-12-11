"use strict";

var mongoose = require('mongoose');

module.exports = function (db) {
	var participationSchema = new mongoose.Schema({
		experiment:  String,  // unique name for experiment
		participant: String,  // unique ID for participant
		variation:   String,  // the variation assinged to this participant
		converted:   Boolean  // has this participant converted? (e.g. signed up, clicked button, etc...)
	});

	participationSchema.index({experimentID: 1, userID: 1});
	participationSchema.index({experimentID: 1, variation: 1});

	return db.model('Participation', participationSchema);
};

