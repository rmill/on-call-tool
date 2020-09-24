/**
 * This module generates the on-call weekly documents by accessing the PagerDuty API
 *
 * usage: node generate-documents <API_KEY>
 *     string <API_KEY>: Your PagerDuty API key
 */

const fetch = require("node-fetch");
const moment = require("moment");
const csv_writer = require('csv-writer')
const fs = require('fs');

CONSOLE_CLEAR = '\x1b[0m'
CONSOLE_MAGENTA = '\x1b[45m'
CSV_FOLDER = './output'
DAYS_IN_WEEK = 7;
MOMENT_SATURDAY = 6;
MOMENT_SUNDAY = 0;
PAGER_DUTY_API_URL = 'https://api.pagerduty.com';

LOGO =
    '________                   _________        .__  .__      _________                  .__       ___________\n' +
    '\\_____  \\   ____           \\_   ___ \\_____  |  | |  |    /   _____/ ______________  _|__| ____ \\_   _____/\n' +
    ' /   |   \\ /    \\   ______ /    \\  \\/\\__  \\ |  | |  |    \\_____  \\_/ __ \\_  __ \\  \\/ /  |/ ___\\ |    __)_ \n' +
    '/    |    \\   |  \\ /_____/ \\     \\____/ __ \\|  |_|  |__  /        \\  ___/|  | \\/\\   /|  \\  \\___ |        \\\n' +
    '\\_______  /___|  /          \\______  (____  /____/____/ /_______  /\\___  >__|    \\_/ |__|\\___  >_______  /\n' +
    '        \\/     \\/                  \\/     \\/                    \\/     \\/                    \\/        \\/ \n'

/**
 * Entry point of application
 */
async function run () {
    log(LOGO);
    const { api_key, start_date } = validate_args();
    log(`Getting Incidents since ${start_date}`);
    const incidents = await get_incidents(api_key, start_date);
    const processed_incidents = process_incidents(incidents);
    await create_csv(processed_incidents);
}

/**
 * Validate and sanitize commandline parameters
 * @returns {api_key: string, start_date: Date}
 */
function validate_args () {
    const args = process.argv;

    if (args.length !== 3) {
        log('USAGE: node generate-documents <API_KEY>\n  string <API_KEY>: Your PagerDuty API key');
        process.exit();
    }

    // In the future allow for a date to be added from the command line. For now it will get the incidents between the
    // last generated CSV and now. The default is the last 7 days.
    const previous_files = fs.readdirSync(CSV_FOLDER).filter(filename => filename.endsWith('.csv'));
    let start_date;

    if (previous_files.length > 0) {
        previous_files.sort();
        const latest_date = previous_files.pop();
        const formatted_date = latest_date.match(/(.*)-incidents.csv/)[1].replace('_', ' ');
        start_date = new Date(formatted_date)
    } else {
        const week_ago = new Date();
        week_ago.setDate(week_ago.getDate() - DAYS_IN_WEEK);
        start_date = week_ago;
    }

    return { api_key: args[2], start_date };
}

/**
 * Get all PagerDuty Incidents
 * @param {string} api_key The PagerDuty API key
 * @param {Date} start_date The date to start retrieving Incidents
 * @returns {[]} An array of PagerDuty Incidents
 */
async function get_incidents (api_key, start_date) {
    let more_pages = true;
    let page_num = 0;
    let limit = 50;
    let incidents = [];

    while (more_pages) {
        const page = await get_incident_page(api_key, start_date, page_num * limit, limit);
        incidents = incidents.concat(page['incidents']);
        more_pages = page['more'];
        page_num++;
    }

    return incidents;
}

/**
 * Get a single page of PagerDuty Incidents
 * @param {string} api_key The PagerDuty API key
 * @param {Date} since The Date to fetch Incidents since
 * @param {number} offset The number of records to skip
 * @param {number} limit The number of records to fetch
 * @returns {Promise<any>}
 */
async function get_incident_page (api_key, since, offset, limit) {
    const response = await fetch(
        `${PAGER_DUTY_API_URL}/incidents?since=${since}&offset=${offset}&limit=${limit}&time_zone=MST&sort_by=created_at:desc`,
        {
            headers: {
                accept: 'application/vnd.pagerduty+json;version=2',
                authorization: `Token token=${api_key}`
            }
        }
    );

    return await response.json();
}

/**
 * Transform PagerDuty Incidents into the on-call spreadsheet format. The returned fields are:
 *
 * 'person', 'date begin', 'date end', 'reason', 'hours earned', 'date reconciled', 'start time',
 * 'time end', 'duration', 'accrual coeff', 'adjusted hours earned', 'outside work hours', 'late night',
 * 'service', 'category', 'callout trigger', 'notes'
 *
 * @param {[]} incidents Array of PagerDuty Incidents
 * @returns {[]} Array of processed Incidents
 */
function process_incidents (incidents) {
    const processed_incidents = [];

    incidents.forEach(incident => {
        if (incident['resolve_reason'] !== null && incident['resolve_reason']['type'] === 'merge_resolve_reason') {
            // This indicates that this incident was merged with another and should not be processed
            return;
        }

        const start_date = moment(incident['created_at']);
        const end_date = moment(incident['last_status_change_at']);
        let resolver = incident['last_status_change_by']['summary']

        // Check if the incident is auto-resolved
        if (resolver === incident['service']['summary']) {
            resolver = 'Auto-resolved';
        }

        const processed_incident = [
            resolver,
            start_date.format("YYYY-MM-DD"),
            end_date.format("YYYY-MM-DD"),
            get_incident_urgency(incident['urgency']),
            get_hours_earned(incident['created_at'], incident['last_status_change_at'], incident['urgency']),
            null, // date reconciled
            start_date.format("HH:mm:ss"),
            end_date.format("HH:mm:ss"),
            (get_incident_duration(incident['created_at'], incident['last_status_change_at']) / 60).toFixed(2),
            null, null, null, null, null, // now unused
            incident['service']['summary'],
            incident['title'],
            incident['html_url']
        ];

        processed_incidents.push(processed_incident);
    });

    return processed_incidents;
}

/**
 * Get the transformed urgency of the Incident
 * @param {string} urgency The PagerDuty Incident urgency
 * @returns {string} The transformed urgency
 */
function get_incident_urgency(urgency) {
    if (urgency === 'high') return 'critical alarm';
    if (urgency === 'low') return 'non-critical alarm';
    return 'unknown';
}

/**
 * Get the number of on-call hours earned
 * @param {string} start_date The start date of the Incident
 * @param {string} end_date The end date of the Incident
 * @param {string} urgency The PagerDuty Incident urgency
 * @returns {number} The number of earned hours
 */
function get_hours_earned (start_date, end_date, urgency) {
    let hours_earned = 0;
    const start_date_obj = moment(start_date);
    const start_hour = start_date_obj.hour();
    const duration_hours = Math.ceil(get_incident_duration(start_date, end_date) / 60);
    const is_weekend = [MOMENT_SATURDAY, MOMENT_SUNDAY].includes(start_date_obj.day());

    // Only critical incidents gain hours
    if (get_incident_urgency(urgency) !== 'critical alarm') return hours_earned;

    // No hours if the incident occurs during work hours
    if (start_hour >= 9 && start_hour <= 17 && !is_weekend) return hours_earned;

    // If the incident is off hours, gain an hour
    hours_earned++;

    // If the incident is late at night, also gain an hour
    if (start_hour <= 4 || start_hour >= 22) hours_earned++;

    // Gain an extra hour for each additional half hour after the first
    hours_earned += Math.max(0, (duration_hours - 1) * 2);

    return hours_earned;
}

/**
 * Get the duration of the Incident in minutes
 * @param {string} start_date The start date of the Incident
 * @param {string} end_date The end date of the Incident
 * @returns {number} The duration in minutes
 */
function get_incident_duration (start_date, end_date) {
    return Math.ceil((Date.parse(end_date) - Date.parse(start_date)) / 1000 / 60);
}

/**
 * Create CSV from the given Incidents
 * @param [] incidents Array of incidents
 * @returns {Promise<void>}
 */
async function create_csv(incidents) {
    const now = moment().format("YYYY-MM-DD_HH:mm:ss");
    const path = `./output/${now}-incidents.csv`;
    const csv = csv_writer.createArrayCsvWriter({ path });

    await csv.writeRecords(incidents);
    log(`Generated new csv: ${path}`);
}

/**
 * Log a message
 * @param string message The message to log
 */
function log(message) {
    console.log(`${CONSOLE_MAGENTA}${message}${CONSOLE_CLEAR}`);
}

// Run the application
run();
