"use strict";

module.exports = function (options) {
  var participantSchema = new options.mongoose.Schema({
    experiment:  String, // experiment name / ID
    user:        String, // user ID
    ip:          String,
    variation:   String, // the variation assinged to this participant
    optedOut: {          // has this participant opted out? (e.g. existing user logged in)
      type: Boolean,
      default: false
    }
  });

  participantSchema.index({experiment: 1, optedOut: 1});
  participantSchema.index({experiment: 1, user: 1});

  return options.db.model('Participant', participantSchema);
};

