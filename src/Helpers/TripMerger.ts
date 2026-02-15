/*
 * Copyright (c) 2024. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import { IDatabaseRitInfoUpdate } from "../Interfaces/DatabaseRitInfoUpdate";
import dayjs from "dayjs";
import { LogicalJourneyChangeType } from "../Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyChangeType";
import { LogicalJourneyPartStationChangeType } from "../Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyPartStationChangeType";

export class TripMerger {
    /**
     * Merges trips that are part of the same material circulation and are close in time and location.
     * @param updates The updates to check for merging.
     */
    public static mergeTrips(updates: IDatabaseRitInfoUpdate[]): IDatabaseRitInfoUpdate[] {
        const tripsByMaterialNumber = new Map<string, IDatabaseRitInfoUpdate[]>();

        for (const update of updates) {
            if (update.materialNumbers) {
                for (const materialNumber of update.materialNumbers) {
                    if (!tripsByMaterialNumber.has(materialNumber)) {
                        tripsByMaterialNumber.set(materialNumber, []);
                    }

                    tripsByMaterialNumber.get(materialNumber)!.push(update);
                }
            }
        }

        const tripsToMerge = new Map<IDatabaseRitInfoUpdate, IDatabaseRitInfoUpdate>();
        // Iterate over all material numbers and check if we can merge trips.
        for (const [materialNumber, trips] of tripsByMaterialNumber) {
            // Sort trips by time
            // Sort trips by time
            trips.sort((a, b) => {
                const timeA = dayjs(a.stops[0].departureTime || a.stops[0].plannedDepartureTime || a.stops[0].arrivalTime || a.stops[0].plannedArrivalTime).unix();
                const timeB = dayjs(b.stops[0].departureTime || b.stops[0].plannedDepartureTime || b.stops[0].arrivalTime || b.stops[0].plannedArrivalTime).unix();
                return a.operationDate.getTime() - b.operationDate.getTime() || timeA - timeB || a.trainNumber - b.trainNumber;
            });

            for (let i = 0; i < trips.length - 1; i++) {
                const tripA = trips[i];
                const tripB = trips[i + 1];

                if (tripA === tripB) continue;

                // Check if the trips are already merged or marked for merging
                if (tripsToMerge.has(tripA) || tripsToMerge.has(tripB)) continue;

                // Check if the trips are in the same series (e.g. 6573 and 6580)
                // If so, they are likely just turning around and starting a new trip, so we should not merge them.
                if (Math.floor(tripA.shortTrainNumber / 100) === Math.floor(tripB.shortTrainNumber / 100)) continue;

                const lastStopA = this.getLastNonCancelledStop(tripA);

                if (!lastStopA) continue; // Should not happen

                const firstStopB = tripB.stops[0];

                if (lastStopA.stationCode === firstStopB.stationCode) {
                    // Check if the time difference is less than 15 minutes
                    const arrivalTimeA = dayjs(lastStopA.arrivalTime || lastStopA.plannedArrivalTime);
                    const departureTimeB = dayjs(firstStopB.departureTime || firstStopB.plannedDepartureTime);

                    const diff = departureTimeB.diff(arrivalTimeA, 'minutes');

                    if (diff >= -5 && diff <= 15 && (lastStopA.actualTrack === firstStopB.actualTrack || lastStopA.plannedTrack === firstStopB.plannedTrack)) {
                        // Check for station overlap to prevent doubling back or illogical loops
                        const indexOfConnectionStopInA = tripA.stops.indexOf(lastStopA);
                        const validStopsA = tripA.stops.slice(0, indexOfConnectionStopInA + 1);
                        const stationCodesA = new Set(validStopsA.map(s => s.stationCode));

                        const hasOverlap = tripB.stops.slice(1).some(s => stationCodesA.has(s.stationCode));

                        if (!hasOverlap) {
                            tripsToMerge.set(tripA, tripB);
                        }
                    }
                }
            }
        }

        const mergedTrips: IDatabaseRitInfoUpdate[] = [];
        const processedTrips = new Set<IDatabaseRitInfoUpdate>();

        for (const update of updates) {
            if (processedTrips.has(update)) continue;

            if (tripsToMerge.has(update)) {
                const tripB = tripsToMerge.get(update)!;

                // Get the index of the connection stop in Trip A
                const lastStopA = this.getLastNonCancelledStop(update);
                const indexOfConnectionStop = update.stops.indexOf(lastStopA!);

                // Create merged trip
                // We slice Trip A's stops up to (and including) the connection stop.
                // Anything after that is cancelled, so we discard it in favor of Trip B's journey.
                const mergedTrip: IDatabaseRitInfoUpdate = {
                    ...update,
                    stops: [...update.stops.slice(0, indexOfConnectionStop + 1), ...tripB.stops],
                    customRealtimeTripId: `${update.trainNumber}_${tripB.trainNumber}`,
                };

                // Handle the connection stop (last of A (valid), first of B)
                const matchedStopA = mergedTrip.stops[indexOfConnectionStop];
                const matchedStopB = mergedTrip.stops[indexOfConnectionStop + 1];

                // Merge them into one stop
                const mergedStop = {
                    ...matchedStopA,
                    ...matchedStopB,
                    changes: [...(matchedStopA.changes || []), ...(matchedStopB.changes || [])],
                    // Prefer actual times/tracks from both if available
                    plannedArrivalTime: matchedStopA.plannedArrivalTime,
                    arrivalTime: matchedStopA.arrivalTime,
                    plannedDepartureTime: matchedStopB.plannedDepartureTime,
                    departureTime: matchedStopB.departureTime,
                    // Keep platform from A if matched, or B? They should be same.
                    platform: matchedStopA.platform || matchedStopB.platform,
                    actualTrack: matchedStopA.actualTrack || matchedStopB.actualTrack,
                    plannedTrack: matchedStopA.plannedTrack || matchedStopB.plannedTrack
                };

                // Replace the two stops with the merged stop
                mergedTrip.stops.splice(indexOfConnectionStop, 2, mergedStop);

                // Recalculate stop sequence for the merged trip
                mergedTrip.stops = mergedTrip.stops.map((stop, index) => ({
                    ...stop,
                    sequence: index + 1
                }));

                console.log(`[TripMerger] Merged train ${update.trainNumber} and train ${tripB.trainNumber} into ${mergedTrip.customRealtimeTripId} at station ${mergedStop.stationCode} track ${mergedStop.actualTrack || mergedStop.plannedTrack}. Material: ${update.materialNumbers?.join(', ')}`);

                mergedTrips.push(mergedTrip);

                // Mark trip B as cancelled
                const cancelledTripB: IDatabaseRitInfoUpdate = {
                    ...tripB,
                    changes: [...(tripB.changes || []), {
                        changeType: LogicalJourneyChangeType.Cancelled,
                    } as any]
                };

                mergedTrips.push(cancelledTripB);

                processedTrips.add(update);
                processedTrips.add(tripB);
            } else {
                mergedTrips.push(update);
                processedTrips.add(update);
            }
        }

        console.log(`[TripMerger] Merged ${tripsToMerge.size} trips.`);

        return mergedTrips;
    }

    private static getLastNonCancelledStop(trip: IDatabaseRitInfoUpdate) {
        // Iterate backwards
        for (let i = trip.stops.length - 1; i >= 0; i--) {
            const stop = trip.stops[i];

            // Checks for strict cancellation of the arrival. 
            // If the departure is cancelled but arrival is not, it's still a valid terminus for the first trip.
            const isCancelled = stop.changes?.some(c => c.changeType === LogicalJourneyPartStationChangeType.CancelledArrival) || stop.actualWillStop === false;

            if (!isCancelled) {
                return stop;
            }
        }
        return null;
    }
}
