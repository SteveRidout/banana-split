"use strict";

module.exports = function (options) {
	var participationSchema = new options.mongoose.Schema({
		experiment:  String,  // unique name for experiment
		participant: String,  // unique ID for participant
		variation:   String,  // the variation assinged to this participant
		converted: {          // has this participant converted? (e.g. signed up, clicked button, etc...) 
			type: Boolean,
			default: false
		},
		optedOut: {           // has this participant opted out? (e.g. existing user logged in)
			type: Boolean,
			default: false
		}
	});

	participationSchema.index({experimentID: 1, userID: 1});
	participationSchema.index({experimentID: 1, optedOut: 1, variation: 1, converted: 1});

	return options.db.model('Participation', participationSchema);
};

