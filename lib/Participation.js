"use strict";

module.exports = function (options) {
	var participationSchema = new options.mongoose.Schema({
		experiment:  String,  // unique name for experiment
		participant: String,  // unique ID for participant
		variation:   String,  // the variation assinged to this participant
		converted:   Boolean  // has this participant converted? (e.g. signed up, clicked button, etc...)
	});

	participationSchema.index({experimentID: 1, userID: 1});
	participationSchema.index({experimentID: 1, variation: 1});

	return options.db.model('Participation', participationSchema);
};

