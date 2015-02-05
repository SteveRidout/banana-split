"use strict";

module.exports = function (options) {
	var experimentSchema = new options.mongoose.Schema({
		name: {type: String, unique: true},
		variations: [{
			name:   String,
			weight: Number // default 1, increase to choose this variation more frequently
		}],

		startDate: Date,
		endDate: Date,
		
		// all the events relevant to this experiment
		events: [{
			name: String
		}]
	});

	experimentSchema.index({name: 1});
	return options.db.model('Experiment', experimentSchema);
};

