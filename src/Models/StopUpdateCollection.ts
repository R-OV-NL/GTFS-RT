/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import { Collection } from "./General/Collection";
import { StopUpdate } from "./StopUpdates/StopUpdate";
import { RitInfoStopUpdate } from "./StopUpdates/RitinfoStopUpdate";

export class StopUpdateCollection extends Collection<RitInfoStopUpdate> {

    private readonly tripId?: string;

    constructor(items: RitInfoStopUpdate[], tripId?: string) {
        super(items);
        this.tripId = tripId;

        if (items.length === 0) return;

        this.setFirstStop();
        this.setLastStop();
        this.setIsLastStopBeforeOnlyCancelledStops();

        //Make sure all times are increasing
        this.checkIncreasingTimes();

    }

    private setFirstStop() {
        const firstStop = this.first();
        firstStop.isFirstStop = true;
        this.set(0, firstStop);
    }

    private setLastStop() {
        const lastStop = this.last();
        lastStop.isLastStop = true;
        this.set(this.length - 1, lastStop);
    }

    /**
     * Checks if the times are increasing. If not, it will fix them.
     * This is done by setting the arrival time to the planned arrival time + min(delay at previous stop, delay at next stop)
     * @private
     */
    private checkIncreasingTimes() {
        // Loop through each stop in the collection
        for (let i = 0; i < this.length; i++) {
            // Get the current stop, as well as the previous and next stops (if they exist)
            const currentStop = this.get(i);
            const previousStop = this.get(i - 1);

            //If there is no previous stop, the arrival and departure times can not be non-increasing, as this is the first stop.
            if (!previousStop)
                continue;

            // Initialize variables to keep track of whether the arrival and departure times are increasing
            let hopTimeIsValid = true;
            let dwellTimeIsValid = true;

            // Check if the current stop's arrival time is increasing (only if arrival is not cancelled)
            if (currentStop.arrivalTime !== null && currentStop.arrivalTime > 0) {
                if (previousStop.departureTime > 0 && currentStop.arrivalTime < previousStop.departureTime) {
                    // If the current stop's arrival time is not increasing, log a warning message
                    console.warn(`[StopUpdateCollection ${this.tripId}] Non-increasing hop time detected for ${previousStop.stationCode}[${previousStop.sequence}]: ${new Date(previousStop.departureTime * 1000).toISOString()} -> ${currentStop.stationCode} [${currentStop.sequence}]: ${new Date(currentStop.arrivalTime * 1000).toISOString()}`);
                    hopTimeIsValid = false;
                }
            }

            // If the arrival is after the departure, the dwell time is invalid.
            if (currentStop.arrivalTime > currentStop.departureTime) {
                console.warn(`[StopUpdateCollection ${this.tripId}] Invalid dwell time detected for stop ${currentStop.stationCode} [${currentStop.sequence}]: Arrival time ${new Date(currentStop.arrivalTime * 1000).toISOString()} is after Departure time ${new Date(currentStop.departureTime * 1000).toISOString()}`);
                dwellTimeIsValid = false
            }

            // If both the arrival and departure times are increasing, we don't need to fix anything
            if (hopTimeIsValid && dwellTimeIsValid) {
                continue;
            }

            const beforeFix = currentStop.arrivalTime;
            // If there is a previous and next stop, we can fix both times (only if they're not cancelled)
            this.fixStopTime(previousStop, currentStop, hopTimeIsValid, dwellTimeIsValid);
            const afterFix = currentStop.arrivalTime;

            console.log(`[StopUpdateCollection ${this.tripId}] Fixed stop times for stop ${currentStop.stationCode} [${currentStop.sequence}]: Arrival time changed from ${beforeFix ? new Date(beforeFix * 1000).toISOString() : 'null'} to ${afterFix ? new Date(afterFix * 1000).toISOString() : 'null'}`);
            // Update the current stop in the collection
            this.set(i, currentStop);
        }
    }

    /**
     * Set the sequence number of each stop to its index in the array + 1
     * @private
     */
    private setSequenceNumbers() {
        for (let i = 0; i < this.length; i++) {
            const stop = this.get(i);
            stop.sequence = i + 1;
            this.set(i, stop);
        }
    }

    /**
     * Fix the current stop time by setting the arrival time to the planned arrival time + min(delay at previous stop, delay at next stop)
     * @param previousStop The previous stop in the sequence
     * @param currentStop The stop that needs to be fixed
     * @param hopTimeIsValid
     * @param dwellTimeIsValid
     */
    private fixStopTime(previousStop: RitInfoStopUpdate, currentStop: RitInfoStopUpdate, hopTimeIsValid: boolean, dwellTimeIsValid: boolean) {
        if (!hopTimeIsValid)
            this.fixHopTime(previousStop, currentStop);

        if (!dwellTimeIsValid)
            this.fixDepartureTime(currentStop);
    }

    /**
     * Fix the arrival time of the current stop by setting it to the planned arrival time + departure delay at previous stop
     * This works under the assumption that no delay is removed between stops.
     * @param previousStop The previous stop in the sequence
     * @param stopToFix The stop that needs to be fixed
     * @private
     */
    private fixHopTime(previousStop: RitInfoStopUpdate, stopToFix: RitInfoStopUpdate) {
        const previousStopScheduledDeparture = previousStop.plannedDepartureTime ?? previousStop.departureTimeAsDate;
        const currentStopScheduledArrival = stopToFix.plannedArrivalTime ?? stopToFix.arrivalTimeAsDate;

        if (previousStopScheduledDeparture == null || currentStopScheduledArrival == null) {
            console.warn(`[StopUpdateCollection ${this.tripId}] Cannot fix hop time for stop ${stopToFix.stopId}: ${stopToFix.name} [${stopToFix.sequence}]. Missing planned times.`);
            return;
        }

        const regularHopTime = (currentStopScheduledArrival.getTime() - previousStopScheduledDeparture.getTime()) / 1000;

        const previousStopActualDeparture = previousStop.departureTime;

        stopToFix.arrivalTime = previousStopActualDeparture + regularHopTime;

        //Check if this has actually fixed the issue:

        if (stopToFix.arrivalTime < previousStop.departureTime) {
            console.warn(`[StopUpdateCollection ${this.tripId}] Failed to fix hop time for stop ${stopToFix.stopId}: ${stopToFix.name} [${stopToFix.sequence}]. Arrival time is still before previous departure time. Arrival: ${new Date(stopToFix.arrivalTime * 1000).toISOString()}, Previous Departure: ${new Date(previousStop.departureTime * 1000).toISOString()}`);
        }
    }

    /**
     * Fix the departure time of the current stop by setting it to the actualArrivalTime + difference between plannedArrivalTime and plannedDepartureTime
     * This works under the assumption that no delay is removed while at the station.
     * @param stopToFix The stop that needs to be fixed
     * @private
     */
    private fixDepartureTime(stopToFix: RitInfoStopUpdate) {
        // If the current stop has a cancelled arrival, we can't fix the departure time
        if (stopToFix.isCancelledArrival()) return;

        // If the current stop has no planned arrival time, we can't fix the departure time
        if (stopToFix.plannedArrivalTime === null) return;

        // If the current stop has no planned departure time, we can't fix the departure time
        if (stopToFix.plannedDepartureTime === null) return;

        // If the current stop has no actual arrival time, we can't fix the departure time
        if (stopToFix.arrivalTime === null) return;

        // Calculate the base new departure time
        let newDepartureTime = stopToFix.arrivalTime + ((stopToFix.plannedDepartureTime.getTime() - stopToFix.plannedArrivalTime.getTime()) / 1000);

        // Ensure the departure time is strictly greater than the arrival time
        newDepartureTime = Math.max(newDepartureTime, stopToFix.arrivalTime + 1);

        stopToFix.departureTime = newDepartureTime;
        stopToFix.departureDelay = stopToFix.arrivalDelay;
    }


    /**
     * Finds the last stop that is still served before only cancelled stops happen.
     * Updates it so that it does not have a departure time, as it will never depart because it is the last stop now.
     */
    private setIsLastStopBeforeOnlyCancelledStops() {

        const collectionHasCancelledStops = this.some(stop => stop.isCancelled());

        // If no stops are cancelled, there is no need to do anything.
        if (!collectionHasCancelledStops) return;

        const lastStopBeforeOnlyCancelledStops = this.findLastStopBeforeOnlyCancelledStops();

        if (lastStopBeforeOnlyCancelledStops === null) return;

        lastStopBeforeOnlyCancelledStops.isLastStopBeforeOnlyCancelledStops = true;

    }

    private findLastStopBeforeOnlyCancelledStops(): StopUpdate | null {
        let lastStopBeforeOnlyCancelledStops: StopUpdate | null = null;

        for (let i = 0; i < this.length; i++) {
            const stop = this.get(i);

            if (stop.isCancelled()) continue;

            lastStopBeforeOnlyCancelledStops = stop;
        }

        return lastStopBeforeOnlyCancelledStops;
    }

    /**
     * Removes all stops that are cancelled in this collection, and returns a new collection without the cancelled stops.
     */
    public removeStopsNotServed() {
        //First check if all stops are cancelled, if so we can just return an empty collection.
        if (this.every(stop => stop.isCancelled()))
            return new StopUpdateCollection([], this.tripId);

        const withoutFilterLength = this.length;
        const filteredStops = this.filter(stop => !stop.isCancelled());
        const filteredLength = filteredStops.length;

        //Sort the stops by their respective arrival or departure times.
        const withNewIndexes = filteredStops.sort((a, b) => {
            if (a.arrivalTime && b.arrivalTime)
                return a.arrivalTime - b.arrivalTime;

            if (a.departureTime && b.departureTime)
                return a.departureTime - b.departureTime;

            if (a.arrivalTime && b.departureTime)
                return a.arrivalTime - b.departureTime;

            if (a.departureTime && b.arrivalTime)
                return a.departureTime - b.arrivalTime;

            return 0;
            // Set the sequence number of each stop to its index in the array + 1
        }).map((stop, index) => {
            stop.sequence = index + 1;
            return stop;
        })

        console.warn(`[StopUpdateCollection] Removed ${withoutFilterLength - filteredLength} stops from trip ${this.tripId} as they were not served.`);
        return new StopUpdateCollection(withNewIndexes, this.tripId);

    }

    public get destination(): string | null {
        //Get the last stop before only cancelled stops.
        const lastStopBeforeOnlyCancelledStops = this.findLastStopBeforeOnlyCancelledStops();

        if (lastStopBeforeOnlyCancelledStops)
            return lastStopBeforeOnlyCancelledStops.destination;

        //If all stops are cancelled, return the destination of the last stop.
        const lastStop = this.last();
        return lastStop?.destination ?? null;
    }
}
