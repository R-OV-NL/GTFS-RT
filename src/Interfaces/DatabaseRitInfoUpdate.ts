/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import { IDatabaseStopUpdate } from "./DatabaseStopUpdate";
import { IJourneyChange } from "../Shared/src/Types/Infoplus/V2/JourneyChange";
import { LogicalJourneyChangeType } from "../Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyChangeType";
import {
    LogicalJourneyPartStationChangeType
} from "../Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyPartStationChangeType";



export interface IDatabaseRitInfoUpdate {
    trainNumber: number;
    shortTrainNumber: number;
    trainType: string;
    agency: string;
    showsInTripPlanner: boolean;
    stops: IRitInfoStopUpdate[];
    tripId: number | null;
    routeId: number | null;
    routeType: number | null;
    routeLongName: string | null;
    agencyId: string | null;
    directionId: number | null;
    shapeId: number | null;
    changes: IJourneyChange<LogicalJourneyChangeType>[] | null;
    timestamp: Date;
    operationDate: Date;
    materialNumbers: string[] | null;
    customRealtimeTripId?: string;
}

export interface IRitInfoStopUpdate extends IDatabaseStopUpdate {
    changes: IJourneyChange<LogicalJourneyPartStationChangeType>[] | null;
    /** PlatformCode in GTFS */
    platform: string | null;
    /** Arrival or DepartureTrack Message in Infoplus */
    track: string | null;

    plannedArrivalTime: string | null;
    plannedDepartureTime: string | null;

    plannedTrack: string | null;
    actualTrack: string | null;
    stationCode: string;
    name: string;
}
