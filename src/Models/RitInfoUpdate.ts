/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import {IDatabaseRitInfoUpdate} from '../Interfaces/DatabaseRitInfoUpdate'
import {RitInfo} from "../Shared/src/Types/Infoplus/RitInfo";
import {ExtendedStopTimeUpdate} from "./GTFS/StopTimeUpdate";
import JourneyChangeType = RitInfo.JourneyChangeType;
import {RitInfoStopUpdate} from "./StopUpdates/RitinfoStopUpdate";
import {StopUpdateCollection} from "./StopUpdateCollection";
import { InternationalAgencys, InternationalTrainSeries } from '../Utilities/InternationalAgencys';
import {JourneyChange} from "../Interfaces/Changes";

export class RitInfoUpdate {
    private readonly _agency: string;
    private readonly _changes: JourneyChange[];
    private readonly _shortTrainNumber: number;
    private readonly _showsInTripPlanner: boolean;
    private readonly _stopCollection: StopUpdateCollection;
    private readonly _trainNumber: number;
    private readonly _trainType: string;
    private readonly _tripId: number | null;
    private readonly _routeId: number | null;
    private readonly _shapeId: number | null;
    private readonly _directionId: number | null;
    private readonly _timestamp: Date;

    private readonly _isInternationalTrain: boolean = false;

    constructor(update: IDatabaseRitInfoUpdate) {
        this._agency = update.agency;
        this._changes = update.changes;
        this._shortTrainNumber = update.shortTrainNumber;
        this._showsInTripPlanner = update.showsInTripPlanner;
        this._stopCollection = new StopUpdateCollection(
            update.stops.map(stop => new RitInfoStopUpdate(stop)),
            update.tripId?.toString()
        );

        this._shapeId = update.shapeId;
        this._trainNumber = update.trainNumber;
        this._trainType = update.trainType;
        this._tripId = update.tripId;
        this._routeId = update.routeId;
        this._directionId = update.directionId;
        this._timestamp = update.timestamp;

        this._isInternationalTrain = this.setInternationalTrain();
    }

    private setInternationalTrain(): boolean {
        let isInternationalTrain = false;

        if(InternationalAgencys.includes(this._agency))
            isInternationalTrain = true;

        if(this._trainNumber < 500)
            isInternationalTrain = true;

        for(const series of InternationalTrainSeries) {
            if(this._trainNumber >= series.start && this._trainNumber <= series.end)
                isInternationalTrain = true;
        }

        return isInternationalTrain;
    }

    /**
     * Is this train a long-distance international train?
     * Hits true when the train is from an international agency or when the train number is below 500.
     * Also hits true for the Utrecht Maliebaan train.
     * @see InternationalAgencys
     * @returns {boolean} True if the train is a long-distance international train, false otherwise.
     */
    public get isSpecialTrain(): boolean {
        return this._isInternationalTrain;
    }

    public get routeId(): string | null {
        if(!this._routeId)
            return null;

        return this._routeId.toString();
    }

    public get shapeId(): string | null {
        if(!this._shapeId)
            return null;

        return this._shapeId.toString();
    }

    public get trainType(): string {
        return this._trainType;
    }

    public get directionId(): number | null {
        return this._directionId;
    }

    public get stops(): StopUpdateCollection {
        return this._stopCollection;
    }

    /**
     * Converts this RitInfoUpdate's stops to GTFS-RT StopTimeUpdates and returns them.
     * @returns {IStopTimeUpdate[]} The GTFS-RT StopTimeUpdates.
     */
    public get stopTimeUpdates(): ExtendedStopTimeUpdate[] {
        return this.stops.map(stop => ExtendedStopTimeUpdate.fromStopUpdate(stop));
    }


    /**
     * Did this trip have any platform changes?
     * @returns {boolean} True if the trip had any platform changes, false otherwise.
     */
    public get hadPlatformChange(): boolean {
        return this.stops.some(stop => (stop as RitInfoStopUpdate).didTrackChange());
    }

    /**
     * Does this trip have any changed stops?
     * @returns {boolean} True if the trip had any changed stops, false otherwise.
     */
    public get hadChangedStops(): boolean {
        return this.stops.some(stop => (stop as RitInfoStopUpdate).isExtraPassing());
    }

    /**
     * Did this trip change its route?
     * True for the following:
     * ChangeStopBehaviour = "30",
        DivertedTrain = "33",
        ShortenedDestination = "34",
        ExtendedDestination = "35",
        OriginShortening = "36",
        OriginExtension = "37",
        ChangedDestination = "41",
        ChangedOrigin = "42",
     * @returns {boolean} True if the trip changed its route, false otherwise.
     */
    public get hasChangedTrip(): boolean {
        if(!this._changes)
            return false;

        return this._changes.some(change =>
            change.changeType == JourneyChangeType.ChangeStopBehaviour ||
            change.changeType == JourneyChangeType.DivertedTrain ||
            change.changeType == JourneyChangeType.ShortenedDestination ||
            change.changeType == JourneyChangeType.ExtendedDestination ||
            change.changeType == JourneyChangeType.OriginShortening ||
            change.changeType == JourneyChangeType.OriginExtension ||
            change.changeType == JourneyChangeType.ChangedDestination ||
            change.changeType == JourneyChangeType.ChangedOrigin
        );
    }

    public get changes(): JourneyChange[] | null {
        return this._changes;
    }

    /**
     * Returns the trip ID of the trip.
     * @returns {string} The trip ID of the trip.
     */
    public get tripId(): string | null {
        if(!this._tripId)
            return null;
        return this._tripId.toString();
    }

    /**
     * Returns the start time of the trip in HH:mm:ss format.
     * @returns {string} The start time of the trip.
     */
    public get startTime(): string {

        const firstStop = this.stops.first();

        if(!firstStop || !firstStop.departureTimeAsDate)
            return '00:00:00';

        return firstStop
            .departureTimeAsDate
            .toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    }

    /**
     * Returns the start date of the trip in YYYYMMDD format.
     * @returns {string} The start date of the trip.
     */
    public get startDate(): string {
        const firstStop = this.stops.first();

        if(!firstStop || !firstStop.departureTimeAsDate)
            return '00000000';

        return firstStop
            .departureTimeAsDate
            .toISOString()
            .slice(0, 10)
            .replaceAll('-', '');
    }

    /**
     * Returns if the trip is cancelled by checking if a change type of 25 (cancelled) is present.
     * @returns {boolean} True if the trip is cancelled, false otherwise.
     */
    public get isCancelled(): boolean {
        if(!this._changes)
            return false;

        return this._changes.some(change =>
            change.changeType == JourneyChangeType.CancelledTrain
        )
    }

    /**
     * Returns if the trip is an extra (added) trip by checking if a change type of 24 (extra train) is present.
     * @returns {boolean} True if the trip is an extra trip, false otherwise.
     */
    public get isAdded(): boolean {
        let isAdded = false;

        if (this._changes)
            isAdded = this._changes.some(change =>
                change.changeType == JourneyChangeType.ExtraTrain
            )

        //Could be incorrect, maybe only 300.000 and 700.000 are added.
        if(!isAdded) {
            // If the short train number does not match the train number, it is an extra train. (E.g. 301234 vs 1234, 701234 vs 1234 or 201234 vs 1234)
            isAdded = this._shortTrainNumber !== this._trainNumber || (this._trainNumber > 100_000 && this._trainNumber < 900_000);
        }

        return isAdded;
    }

    public get hasModifiedStopBehaviour(): boolean {
        let didModify = false;

        if(this._changes)
            didModify = this._changes.some(change =>
                change.changeType == JourneyChangeType.ChangeStopBehaviour
            )

        if(!didModify)
            didModify = this.stops.some(stop => stop.isExtraPassing() || stop.wasntPlannedToStop())

        return didModify;
    }

    /**
     * Gets the timestamp of the update in seconds since epoch.
     * @returns {Long} The timestamp of the update in seconds since epoch.
     */
    public get timestamp(): number {
        return Math.round(this._timestamp.getTime() / 1000);
    }


}