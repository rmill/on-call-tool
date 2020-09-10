# On-call Tool

This repository contains all tools necessary to perform On-call Manager tasks.

### Generating the weekly On-call PagerDuty Incidents spreadsheet

This tool will generate a spreadsheet of PagerDuty Incidents.

**Installation**

This assumes you have installed a version of NodeJs.

```npm install```

**Usage**

To get the usage, just type in the command with no parameters

```node generate-documents.js```

To generate the spreadsheet

```node generate-documents.js <API_KEY>```

Replace **<API_KEY>** with your [PagerDuty API key](https://support.pagerduty.com/docs/generating-api-keys)

After you run this command a .csv will be added to the ```/output``` folder. If this is the first time you have run this command, or the ```/output``` folder is empty, the spreadsheet will contain all PagerDuty incidents in the past 7 days. If a spreadsheet exists in the folder it will get all Incidents since the generation of the last file. 
