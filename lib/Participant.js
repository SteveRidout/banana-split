"use strict";

module.exports = function(options) {
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

  participantSchema.index({experimentID: 1, userID: 1});
  participantSchema.index({experimentID: 1, optedOut: 1, variation: 1, converted: 1});

  return options.db.model('Participant', participantSchema);
};

