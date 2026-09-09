const { formatEod } = require('./format-eod');

const sample = {
  messages: [
    {
      author: 'Rajib Chowdhury',
      timestamp: '8:24 PM',
      body: `EOD
Opportunity Ticket stage automation with respect to associated appointment status
During Calendar opportunity creation: Quick Opportunity Edit option with source (gmb, google, facebook , web)
During Appointment creation from calendar , give option to set appointment status(previously it was always set to booked)`,
    },
    {
      author: 'Alauddin Rezvi',
      timestamp: '9:38 PM',
      body: `EOD:
Alauddin Rezvi (03/09/2026):

#721: Calling Agent - 
          -Worked on MCP Microservice = Progress : 75% ( Working with CRM and EMR appointment and contacts syncing)`,
    },
    {
      author: 'Mohammad Ashikuzzaman',
      timestamp: '9:41 PM',
      body: `EOD:

#2965: New Request | Revamp the patient memberships module -  Quick Live Issue fix - Fixed some UI change requests from QA and deployed Live - It will be recurring, and faster to make everything smooth before making it available for the real facility
#3141: Issue | Calysta Auto-Deleting Signed Intake & Consent Forms - Juniper Brown - fixed and deployed Live - It will not happen in the future
 #3142: Client request | Configure Secondary Domain (ethosspa.net) for spa.guru - Passed info to Server team - After they configure the SSL, I will add it into our codebase
#3143: Client Request | Export all encounters for Ethos - Done - Sent via email`,
    },
    {
      author: 'Tamzida Azad',
      timestamp: '10:38 PM',
      body: `EOD:
 #3062: Change request for the membership revamp with Elavon - 65% done on Training Academy 
 Retested the UI and Functional fixes on membership module 
Verified membership revamped kpi report 
Verified membership initiation fee related report and outgoings email 
Verified all sent email and SMS gets stored on patient logs`,
    },
  ],
};

const formatted = formatEod(sample, { date: new Date('2026-09-03T17:00:00+06:00') });
console.log(formatted.payloadText);
console.log('\n--- stats ---');
console.log({ people: formatted.personCount, updates: formatted.updateCount, date: formatted.date });
