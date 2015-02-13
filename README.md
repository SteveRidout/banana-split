Banana Split - early alpha version
------------

A small split testing module using MongoDB for storage. This is a back-end library, not a standalone app.

Use it on your Node.js web server to:

1. Create experiments with multiple variations
2. Randomly assign variations to each user
3. Record each conversion
4. Get conversion rates and confidence intervals for each variation

Scope - What it does
--------------------

This is a back-end library for split-testing (AKA A/B testing or multivariate testing) and event tracking.

- Stores all data in MongoDB, including experiments, participants, and events
- Allocates a random variation for each participant in an experiment
- Tracks events generated by participants. e.g. "signup", "upgraded", "clicked-button"
- Calculates the conversion rates for each variation in a given (experiment, event) pair

Scope - What it doesn't do
--------------------------

- No UI - there's no admin panel or dashboard of any kind
- No HTTP server - it doesn't have a HTTP API (although it would be trivial to write one if you wish)

Getting Started
---------------

Add banana-split to your node.js project:

    npm install banana-split --save

In your node.js code, initialize the module as follows:

    // set up a mongodb connection with mongoose
    var mongoose = require('mongoose');
    var db = mongoose.createConnection("mongodb://localhost:27017/myappdata");

    var bananaSplit = require('banana-split')({
      db: db, 
      mongoose: mongoose
    });

Add an experiment...

    bananaSplit.initExperiment({
      name: 'buttonColor',
      variations: ['red', 'green']
    });

Let's participate a user with ID 'user-1' and IP address '127.0.0.1'...

    bananaSplit.participate({
      experiment: 'button-color',
      user: 'user-1',
      ip: '127.0.0.1'
    }, function (err, variation) {
      // variation will now be either 'red' or 'green'
    })

Track a couple of events by this user... 

    bananaSplit.trackEvent({
      user: 'user-1',
      ip: '127.0.0.1',
      name: 'signup'
    })
    bananaSplit.trackEvent({
      user: 'user-1',
      ip: '127.0.0.1',
      name: 'click-button'
    })

Later, after many users have participated and generated events, calculate the results with...

    bananaSplit.getResult('buttonColor', 'name', function (err, result) {
      // put code to deal with result here
    });

Here's an example of the kind of the result from getResult():

    {
      "lastCalculated": "2015-02-13T11:21:12.255Z",
      "startDate": "2014-01-05T15:31:05.000Z",
      "experiment": "button-color",
      "event": "click-button",
      "variations": [
        {
          "confidenceInterval": 0.02961635085131982,
          "conversionRate": 0.5146252285191956,
          "conversions": 563,
          "participants": 1094,
          "name": "red"
        },
        {
          "confidenceInterval": 0.029085324570063693,
          "conversionRate": 0.3782771535580524,
          "conversions": 404,
          "participants": 1068,
          "name": "green"
        }
      ]
    }

To interpret these confidence intervals, there's a 95% chance that the true conversionRate lies within the range:

  conversionRate ± confidenceInterval

i.e. we have a 95% confidence that conversion rate for the "red" variation is:

  51.5% ± 3.0% or 48.5% - 54.5%

## Anonymous and signed in users
 
Banana-split doesn't distinguish between anonynous and signed in users. In case it helps, this is the method I'm using to handle anonymous users:

### 1. New anonymous visitor hits landing page

- Generate a user ID for the anonymous visitor and place it in session storage.
- Participate in any appropriate experiments on this landing page using this user ID.
- Render the page based on the variations.

### 2. Anonymous visitor signs up for new account

- Use the generated user ID as their new permenant user ID

### 3. Anonymous visitor signs in to an existing account

- The temporary user ID is no longer interesting, and to avoid adding noise to the data, I opt-out this temporary user using the following function:

    bananaSplit.optOut({
      user: '54dded1e5287fcd4a5717c04'
    })

## More about getResult()

### Filtering: only one participant from each IP address

The getResult() function filters out all but the first user from a given IP address. This is to:

1. Eliminate a lot of new 'users' who were generated when an existing user signs out.
2. Prevent many requests from one IP address from adding noise. e.g. search engine bots or other web-scrapers will only be counted once each
3. Prevent many users from one IP address skewing the results. e.g. if many users joined from a single IP address there's a good chance they all belong to the same familiy or organization and may share a certain bias which could skew the results.

The data for all these users is stored in MongoDB so changing this behavior is possible after gathering the data. The behavior above is based on my intuition and needs and if you'd like it to be different please let me know and I can add an option.

### WARNING: Scaling for large websites

As the number of participants and events increases, calls to getResult() will become more expensive. It would make sense to calculate this incrementally instead of re-calculating it from scratch each time.

## State of development

I'm using this in production for [Readlang](http://readlang.com) but it's still immature. If you decide to use it I'd love to hear from you, please report issues and suggestions for improvements on the issues page.

