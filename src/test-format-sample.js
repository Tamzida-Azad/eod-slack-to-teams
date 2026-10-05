const { formatEod } = require('./format-eod');

const sample = {
  messages: [
    {
      author: 'Alex Example',
      timestamp: '8:24 PM',
      body: `EOD
Opportunity ticket stage automation with appointment status
Calendar quick-edit option with marketing sources (web, social)`,
    },
    {
      author: 'Jordan Example',
      timestamp: '9:38 PM',
      body: `EOD:
Jordan Example (03/09/2026):

#721: Integration service -
          -Worked on sync microservice = Progress : 75%`,
    },
    {
      author: 'Sam Example',
      timestamp: '9:41 PM',
      body: `EOD:

#2965: Feature | Revamp membership module - QA fixes deployed
#3141: Issue | Signed intake forms retention - fixed and deployed
 #3142: Client request | Secondary domain SSL - waiting on infra team
#3143: Client Request | Export encounters batch - Done - Sent via email`,
    },
    {
      author: 'Taylor Example',
      timestamp: '10:38 PM',
      body: `EOD:
 #3062: Change request for payment integration - 65% done on training docs
 Retested UI and functional fixes on membership module
Verified KPI and notification reports`,
    },
  ],
};

const formatted = formatEod(sample, { date: new Date('2026-09-03T17:00:00+06:00') });
console.log(formatted.payloadText);
console.log('\n--- stats ---');
console.log({ people: formatted.personCount, updates: formatted.updateCount, date: formatted.date });
