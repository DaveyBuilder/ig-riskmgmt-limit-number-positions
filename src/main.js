import { loginIG } from './helper_functions/login_ig.js';
import { getOpenPositions } from './helper_functions/open_positions.js';
import {isMarketOpen} from './helper_functions/is_market_open.js';
import { closePosition } from './helper_functions/close_position.js';

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

    const openPositionsData = await getOpenPositions(env, CST, X_SECURITY_TOKEN, baseURL);

    let openPositions = {};

    openPositionsData.positions.forEach(position => {
        const instrumentName = position.market.instrumentName;
        if (openPositions[instrumentName]) {
            openPositions[instrumentName].positions.push(position);
        } else {
            openPositions[instrumentName] = { positions: [position] };
        }
    });

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

    // Iterate over positionsToClose and make a request for each
    let closedPositionsErrors = [];
    for (const position of positionsToClose) {
        try {
            await closePosition(env, CST, X_SECURITY_TOKEN, baseURL, position);
        } catch (error) {
            closedPositionsErrors.push(error);
        }
    }

    if (closedPositionsErrors.length > 0) {
        throw new Error(`Failed to close positions: ${closedPositionsErrors.map(error => error.message).join(", ")}`);
    }

    //return positionsToClose;

}