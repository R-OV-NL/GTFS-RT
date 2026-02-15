/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import { transit_realtime } from '../Compiled/compiled';

import TripDescriptor = transit_realtime.TripDescriptor;
import ScheduleRelationship = transit_realtime.TripDescriptor.ScheduleRelationship;
import { IDatabaseRitInfoUpdate } from "../Interfaces/DatabaseRitInfoUpdate";
import { RitInfoUpdate } from "./RitInfoUpdate";
import FeedEntity = transit_realtime.FeedEntity;
import { TripIdWithDate } from "../Interfaces/TVVManager";
import TripUpdate = transit_realtime.TripUpdate;
import { EInfoPlusAgency, InfoPlusAgency } from "../Shared/src/Types/API/V2/InfoPlus/Agency";


export class TrainUpdate extends TripUpdate {
    constructor(tripUpdate: TripUpdate, public readonly hasCustomTripId: boolean = false) {
        super(tripUpdate);
    }

    public static fromRitInfoUpdate(infoPlusTripUpdate: IDatabaseRitInfoUpdate): TrainUpdate | null {
        const createdTrip = new RitInfoUpdate(infoPlusTripUpdate);

        const {
            routeLongName,
            startTime,
            startDate,
            directionId,
            isCancelled,
            isAdded,
            timestamp,
            shapeId,
            hadChangedStops,
            hadPlatformChange,
            hasChangedTrip,
            isSpecialTrain,
            hasModifiedStopBehaviour,
            trainType,
            trainNumber,
            destination
        } = createdTrip;
        let { tripId, stopTimeUpdates, routeId, agencyId, routeType } = createdTrip;

        let customTripId = false;

        if (!tripId) {
            tripId = `${trainNumber}_${infoPlusTripUpdate.trainType}_${infoPlusTripUpdate.agency}`;
            customTripId = true;
        }

        if (!agencyId) {
            agencyId = InfoPlusAgency.toAgencyId(infoPlusTripUpdate.agency as unknown as EInfoPlusAgency);
            // console.log(`[TrainUpdate] AgencyId not found for trip ${tripId}. Using agency from InfoPlus: ${infoPlusTripUpdate.agency} -> ${agencyId}`);
        }

        if (!routeId) {
            routeId = `${infoPlusTripUpdate.agency}_${infoPlusTripUpdate.trainType}_${trainNumber}`;
            // console.log(`[TrainUpdate] RouteId not found for trip ${tripId}. Using custom routeId: ${routeId}`);
        }

        if (!routeType) {
            if (infoPlusTripUpdate.trainType.includes("MTS") || infoPlusTripUpdate.trainType.includes("MTR") || infoPlusTripUpdate.trainType.includes("NSM"))
                routeType = 1;
            else if (infoPlusTripUpdate.trainType.includes("NST"))
                routeType = 0;
            else if (trainNumber > 900_000)
                routeType = 3;
            else
                routeType = 2;

        }

        let scheduleRelationship = ScheduleRelationship.SCHEDULED;

        let shouldRemoveSkippedStops = false;

        if (hasChangedTrip || hadPlatformChange || hadChangedStops || hasModifiedStopBehaviour) {

            // if(hasChangedTrip)
            //     console.log(`[TrainUpdate] Trip ${tripId} had a changed trip. Change types: ` + createdTrip.changes!.map(change => change.changeType).join(', '));

            scheduleRelationship = ScheduleRelationship.REPLACEMENT;
            /**
             * Remove all skipped stops, as OTP expects no skipped stops.
             * @deprecated OTP Does allow skipped stops, but they *need* an arrival and departure event.
             */
            shouldRemoveSkippedStops = false;
        }

        // If this is a special train, we want to mark it as a replacement, as the sequence numbers do not match with the static GTFS.
        if (isSpecialTrain) {
            scheduleRelationship = ScheduleRelationship.REPLACEMENT;

            //For these special trains there can be duplicate stops, so we need to remove them. Only keep one stop with the same stopId.
            stopTimeUpdates = stopTimeUpdates.filter((stopTimeUpdate, index, self) =>
                index === self.findIndex((t) => (
                    t.stopId === stopTimeUpdate.stopId
                ))
            )
        }


        if (isAdded || customTripId) {
            // Add a suffix to the tripId to make it unique for the added trip.
            tripId = tripId + '_added';
            scheduleRelationship = ScheduleRelationship.ADDED;

            /**
             * Remove all skipped stops, as OTP expects no skipped stops.
             * @deprecated OTP Does allow skipped stops, but they *need* an arrival and departure event.
             */
            shouldRemoveSkippedStops = false;
        }

        if (isCancelled)
            scheduleRelationship = ScheduleRelationship.CANCELED;

        // If this is a added and cancelled trip, we don't want to send it.
        if (isCancelled && isAdded)
            return null;

        if (shouldRemoveSkippedStops)
            stopTimeUpdates = stopTimeUpdates.filter(stopTimeUpdate => stopTimeUpdate.scheduleRelationship !== transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED);

        const tripDescriptor: TripDescriptor = TripDescriptor.create({
            tripId,
            routeId,
            startTime,
            startDate,
            directionId,
            scheduleRelationship,
            ".transit_realtime.ovapiTripdescriptor": {
                realtimeTripId: "IFF:" + trainType + ":" + (infoPlusTripUpdate.customRealtimeTripId ? infoPlusTripUpdate.customRealtimeTripId : trainNumber),
            },
            ".transit_realtime.tripDescriptor": {
                agencyId: agencyId,
                routeType: routeType,
                routeLongName: routeLongName,
            }
        });


        const tripUpdate = TripUpdate.create({
            trip: tripDescriptor,
            stopTimeUpdate: !isCancelled ? stopTimeUpdates : [],
            timestamp: timestamp,
            tripProperties: {
                shapeId: shapeId,
                tripHeadsign: destination,
                tripShortName: trainNumber.toString(),
            },
        })

        return new TrainUpdate(tripUpdate, customTripId)
    }

    /**
     * Will create a TrainUpdate with a DELETE schedule relationship for the given tripId.
     * @param tripId The tripId to create the TrainUpdate for.
     */
    public static fromTripId(tripId: TripIdWithDate): TrainUpdate {
        return new TrainUpdate(
            TripUpdate.create({
                trip: TripDescriptor.create({
                    tripId: tripId.tripId.toString(),
                    scheduleRelationship: ScheduleRelationship.CANCELED,
                    startDate: tripId.operationDate.replaceAll('-', ''),
                }),
                stopTimeUpdate: []
            }), undefined)
    }

    /**
     * Marks this TrainUpdate as deleted, by setting the schedule relationship to DELETED (or CANCELED).
     *
     * @modifies this.trip.scheduleRelationShip
     */
    public markAsDeleted() {
        this.trip.scheduleRelationship = ScheduleRelationship.CANCELED;
        this.stopTimeUpdate = [];
    }

    /**
     * Converts the TrainUpdate to a FeedEntity.
     * @returns {FeedEntity} The converted FeedEntity.
     */
    public toFeedEntity(): FeedEntity {
        return FeedEntity.create(
            {
                id: this.trip.tripId,
                tripUpdate: {
                    ...this,
                },

            }
        )
    }
}

