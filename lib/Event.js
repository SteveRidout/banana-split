"use strict";

module.exports = function (options) {
	var eventSchema = new options.mongoose.Schema({
		name: String, // event name
		user: String, // user ID
		ip:   String
	});

	eventSchema.index({experiment: 1});
	eventSchema.index({user: 1});

	return options.db.model('Event', eventSchema);
};

