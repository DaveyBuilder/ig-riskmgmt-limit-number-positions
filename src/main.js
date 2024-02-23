import { loginIG } from './helper_functions/login_ig.js';
import { getOpenPositions } from './helper_functions/open_positions.js';
import {isMarketOpen} from './helper_functions/is_market_open.js';

export async function executeScheduledTask(request, env, ctx, usingDemoAccount) {
    
    let baseURL;
    if (usingDemoAccount) {
        baseURL = 'https://demo-api.ig.com/gateway/deal';
    } else {
        baseURL = 'https://api.ig.com/gateway/deal';
    }

    const { CST, X_SECURITY_TOKEN } = await loginIG(env, baseURL);

    // Check if nasdaq 100 futures are open & exit if not
	const marketStatus = await isMarketOpen(env, CST, X_SECURITY_TOKEN, baseURL);
	if (marketStatus === "EDITS_ONLY") {
		return;
	}

    const openPositions = await getOpenPositions(env, CST, X_SECURITY_TOKEN, baseURL);

    const numberOfInstruments = Object.keys(openPositions).length;

    // If 12 or less positions then dont need to do anything
    if (numberOfInstruments <= 12) {
        return;
    }

    // For each key in openPositions, get the earliest open date
    for (const instrumentName in openPositions) {
        let earliestDate = null;

        // For each position in the instrument
        openPositions[instrumentName].positions.forEach(position => {
            const positionDate = new Date(position.position.createdDateUTC);

            if (!earliestDate || positionDate < earliestDate) {
                earliestDate = positionDate;
            }
        });

        // Add it as a property to the instrument
        openPositions[instrumentName].earliestOpenDate = earliestDate.toISOString();

    }

    // Now check which is the most recently opened position
    let mostRecentInstrumentName = null;
    let mostRecentDate = null;

    for (const instrumentName in openPositions) {
        const instrumentDate = new Date(openPositions[instrumentName].earliestOpenDate);

        if (!mostRecentDate || instrumentDate > mostRecentDate) {
            mostRecentDate = instrumentDate;
            mostRecentInstrumentName = instrumentName;
        }
    }

    //console.log(`Most recent instrument: ${mostRecentInstrumentName}, Date: ${mostRecentDate.toISOString()}`);

    // Create the array that contains the details needed for closure
    const positionsToClose = [];
    for (const item of openPositions[mostRecentInstrumentName].positions) {
        if (item.market.marketStatus === "TRADEABLE") {
            const positionDetailsForClosure = {
                dealId: item.position.dealId,
                epic: null,
                expiry: null,
                direction: item.position.direction === "BUY" ? "SELL" : "BUY",
                size: String(item.position.size),
                level: null,
                orderType: "MARKET",
                timeInForce: "FILL_OR_KILL",
                quoteId: null,
            };
            positionsToClose.push(positionDetailsForClosure);
        }
    }

    // Now close each position in positionsToClose
    
    const closePositionHeaders = {
        'Content-Type': 'application/json',
        'X-IG-API-KEY': env.IG_API_KEY,
        'Version': '1',
        'CST': CST,
        'X-SECURITY-TOKEN': X_SECURITY_TOKEN,
        '_method': 'DELETE'
    };

    // Iterate over positionsToClose and make a request for each
    for (const position of positionsToClose) {
        const response = await fetch(`${baseURL}/positions/otc`, {
            method: 'POST',
            headers: closePositionHeaders,
            body: JSON.stringify(position)
        });

        if (!response.ok) {
            console.error(`Failed to close position. Status code: ${response.status}`);
        } else {
            console.log(`Position closed successfully.`);
        }
    }

    //return positionsToClose;

}