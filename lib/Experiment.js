"use strict";

module.exports = function (options) {
	var experimentSchema = new options.mongoose.Schema({
		name: {type: String, unique: true},
		variations: [{
			name: String
		}]
	});

	experimentSchema.index({name: 1});
	return options.db.model('Experiment', experimentSchema);
};

