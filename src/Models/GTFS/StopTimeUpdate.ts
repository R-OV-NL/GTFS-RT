/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import {transit_realtime} from "gtfs-rb";
import IStopTimeUpdate = transit_realtime.TripUpdate.IStopTimeUpdate;
import IStopTimeEvent = transit_realtime.TripUpdate.IStopTimeEvent;
import StopTimeEvent = transit_realtime.TripUpdate.StopTimeEvent;
import {RitInfoStopUpdate} from "../RitinfoStopUpdate";

export class StopTimeUpdate implements IStopTimeUpdate {
    departure: IStopTimeEvent;
    arrival: IStopTimeEvent;
    stopId: string;
    scheduleRelationship: transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship;
    stopSequence: number;

    constructor(stopTimeUpdate: IStopTimeUpdate) {
        Object.assign(this, stopTimeUpdate);
    }

    /**
     * Creates a new StopTimeUpdate from a RitInfoStopUpdate.
     * @param update The RitInfoStopUpdate to convert.
     * @returns {StopTimeUpdate} The converted StopTimeUpdate.
     */
    public static fromRitInfoStopUpdate(update: RitInfoStopUpdate): StopTimeUpdate {

        const { departureDelay, arrivalDelay, departureTime, arrivalTime, stopId, sequence, isLastStop, isFirstStop  } = update;

        const departure = new StopTimeEvent({
            time: departureTime,
            delay: departureDelay
        });

        const arrival = new StopTimeEvent({
            time: arrivalTime,
            delay: arrivalDelay
        });



        const scheduleRelationship = update.isCancelled() ?
            transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED :
            transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED;

        return new StopTimeUpdate({
            stopId,
            stopSequence: sequence,
            departure: !isLastStop ? departure : undefined,
            arrival: !isFirstStop ? arrival : undefined,
            scheduleRelationship
        });
    }
}