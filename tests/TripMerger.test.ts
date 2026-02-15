import { describe, it, expect } from "bun:test";
/*
 * Copyright (c) 2024. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import { TripMerger } from "../src/Helpers/TripMerger";
import { IDatabaseRitInfoUpdate } from "../src/Interfaces/DatabaseRitInfoUpdate";
import { LogicalJourneyChangeType } from "../src/Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyChangeType";
import { LogicalJourneyPartStationChangeType } from "../src/Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyPartStationChangeType";

describe("TripMerger", () => {
    it("should merge two trips that match the criteria", () => {
        const tripA: IDatabaseRitInfoUpdate = {
            trainNumber: 100,
            shortTrainNumber: 100,
            trainType: "IC",
            agency: "NS",
            showsInTripPlanner: true,
            stops: [
                {
                    stopId: 12345,
                    sequence: 1,
                    arrivalTime: null,
                    arrivalDelay: 0,
                    departureTime: "2024-01-01T10:00:00Z",
                    departureDelay: 0,
                    plannedArrivalTime: null,
                    plannedDepartureTime: "2024-01-01T10:00:00Z",
                    plannedWillStop: true,
                    actualWillStop: true,
                    destination: "B",
                    stationCode: "A",
                    name: "Station A",
                    changes: null,
                    platform: "1",
                    track: "1",
                    plannedTrack: "1",
                    actualTrack: "1"
                },
                {
                    stopId: 67890,
                    sequence: 2,
                    arrivalTime: "2024-01-01T10:30:00Z",
                    arrivalDelay: 0,
                    departureTime: null,
                    departureDelay: 0,
                    plannedArrivalTime: "2024-01-01T10:30:00Z",
                    plannedDepartureTime: null,
                    plannedWillStop: true,
                    actualWillStop: true,
                    destination: "B",
                    stationCode: "B",
                    name: "Station B",
                    changes: null,
                    platform: "2",
                    track: "2",
                    plannedTrack: "2",
                    actualTrack: "2"
                }
            ],
            tripId: 1,
            routeId: 1,
            routeType: 1,
            routeLongName: "Route A",
            agencyId: "NS",
            directionId: 1,
            shapeId: 1,
            changes: null,
            timestamp: new Date(),
            operationDate: new Date("2024-01-01"),
            materialNumbers: ["1234"]
        };

        const tripB: IDatabaseRitInfoUpdate = {
            trainNumber: 200,
            shortTrainNumber: 200,
            trainType: "IC",
            agency: "NS",
            showsInTripPlanner: true,
            stops: [
                {
                    stopId: 67890,
                    sequence: 1,
                    arrivalTime: null,
                    arrivalDelay: 0,
                    departureTime: "2024-01-01T10:40:00Z",
                    departureDelay: 0,
                    plannedArrivalTime: null,
                    plannedDepartureTime: "2024-01-01T10:40:00Z",
                    plannedWillStop: true,
                    actualWillStop: true,
                    destination: "C",
                    stationCode: "B",
                    name: "Station B",
                    changes: null,
                    platform: "2",
                    track: "2",
                    plannedTrack: "2",
                    actualTrack: "2"
                },
                {
                    stopId: 111213,
                    sequence: 2,
                    arrivalTime: "2024-01-01T11:00:00Z",
                    arrivalDelay: 0,
                    departureTime: null,
                    departureDelay: 0,
                    plannedArrivalTime: "2024-01-01T11:00:00Z",
                    plannedDepartureTime: null,
                    plannedWillStop: true,
                    actualWillStop: true,
                    destination: "C",
                    stationCode: "C",
                    name: "Station C",
                    changes: null,
                    platform: "3",
                    track: "3",
                    plannedTrack: "3",
                    actualTrack: "3"
                }
            ],
            tripId: 2,
            routeId: 2,
            routeType: 1,
            routeLongName: "Route B",
            agencyId: "NS",
            directionId: 1,
            shapeId: 1,
            changes: null,
            timestamp: new Date(),
            operationDate: new Date("2024-01-01"),
            materialNumbers: ["1234"]
        };

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2); // One merged trip + one cancelled trip

        const mergedTrip = result[0];
        expect(mergedTrip.stops).toHaveLength(3); // A -> B -> C
        expect(mergedTrip.customRealtimeTripId).toBe("100_200");
        expect(mergedTrip.tripId).toBe(1); // Should keep trip ID of A

        // Check the middle stop (Connection at B)
        const connectionStop = mergedTrip.stops[1];
        expect(connectionStop.stationCode).toBe("B");
        expect(connectionStop.arrivalTime).toBe("2024-01-01T10:30:00Z");
        expect(connectionStop.departureTime).toBe("2024-01-01T10:40:00Z");

        const cancelledTrip = result[1];
        expect(cancelledTrip.trainNumber).toBe(200);
        expect(cancelledTrip.changes).toContainEqual(expect.objectContaining({ changeType: LogicalJourneyChangeType.Cancelled }));

        // Cancelled trip should still have stops to avoid crash
        expect(cancelledTrip.stops).not.toHaveLength(0);
    });

    it("should NOT merge trips if material number doesn't match", () => {
        const tripA = { ...mockTrip(100, "A", "B", "10:00", "10:30"), materialNumbers: ["1111"] };
        const tripB = { ...mockTrip(200, "B", "C", "10:40", "11:00"), materialNumbers: ["2222"] };

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2);
        expect(result[0]).toBe(tripA);
        expect(result[1]).toBe(tripB);
    });

    it("should merge trips if they share AT LEAST ONE material number", () => {
        // Trip A has materials [1111, 2222]
        const tripA = {
            ...mockTrip(100, "A", "B", "10:00", "10:30"),
            materialNumbers: ["1111", "2222"]
        };
        // Trip B only has material [1111]
        const tripB = {
            ...mockTrip(200, "B", "C", "10:40", "11:00"),
            materialNumbers: ["1111"]
        };

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2); // Merged + Cancelled
        expect(result[0].customRealtimeTripId).toBe("100_200");
    });

    it("should NOT merge trips if the second trip starts significantly before the first ends", () => {
        // Trip A: Ends 14:00
        const tripA = mockTrip(100, "A", "B", "13:00", "14:00");
        // Trip B: Starts 10:00 (Same day, so 4 hours before A ends)
        const tripB = mockTrip(200, "B", "C", "10:00", "11:00");

        const result = TripMerger.mergeTrips([tripA, tripB]);

        // Expectation: Do NOT merge.
        expect(result).toHaveLength(2);
        // Original trips should be returned untouched (or at least not merged)
        expect(result[0].customRealtimeTripId).toBeUndefined();
        expect(result[1].customRealtimeTripId).toBeUndefined();
    });

    it("should merge trips crossing midnight correctly if dates are correct", () => {
        // Trip A: 23:30 -> 23:55 (Today)
        const tripA = mockTrip(100, "A", "B", "23:30", "23:55");
        // Trip B: 00:05 -> 00:30 (Tomorrow)
        const tripB = mockTrip(200, "B", "C", "00:05", "00:30");

        // Set Trip B to be tomorrow
        // We need to ensure operationDate is set so sorting puts B after A?
        // TripMerger sorts by operationDate.
        // If Trip A operationDate is Today. Trip B is Tomorrow.
        // Then A comes first.
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tripB.operationDate = tomorrow;

        // And update the ISO strings to reflect tomorrow
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        const todayStr = new Date().toISOString().split('T')[0];

        // Hacky string replace to update the date part of ISO strings
        // mockTrip uses "2024-01-01" hardcoded.
        // So let's just make Trip A "2024-01-01" and Trip B "2024-01-02".
        tripA.operationDate = new Date("2024-01-01T00:00:00Z");

        tripB.operationDate = new Date("2024-01-02T00:00:00Z");
        tripB.stops.forEach(s => {
            if (typeof s.departureTime === 'string') s.departureTime = s.departureTime.replace("2024-01-01", "2024-01-02");
            if (typeof s.plannedDepartureTime === 'string') s.plannedDepartureTime = s.plannedDepartureTime.replace("2024-01-01", "2024-01-02");
            if (typeof s.arrivalTime === 'string') s.arrivalTime = s.arrivalTime.replace("2024-01-01", "2024-01-02");
            if (typeof s.plannedArrivalTime === 'string') s.plannedArrivalTime = s.plannedArrivalTime.replace("2024-01-01", "2024-01-02");
        });

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2); // Merged + Cancelled
        expect(result[0].customRealtimeTripId).toBe("100_200");
    });

    it("should NOT merge trips if they belong to the same series (e.g. 6573 and 6580)", () => {
        // Trip A: 6573 (Series 6500)
        // Trip B: 6580 (Series 6500)
        // Even if times align, they should NOT merge.
        const tripA = mockTrip(6573, "A", "B", "10:00", "10:30");
        const tripB = mockTrip(6580, "B", "C", "10:35", "11:00");

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2);
        expect(result[0].customRealtimeTripId).toBeUndefined();
        expect(result[1].customRealtimeTripId).toBeUndefined();
    });

    it("should merge trips if the first trip is cancelled after the connection station", () => {
        // Trip A: A -> B -> C -> D.
        // Cancelled at C and D. So it effectively ends at B.
        // Trip B: B -> E.
        // Should merge at B.

        const tripA = mockTrip(100, "A", "D", "10:00", "11:00");
        // Add intermediate stops
        tripA.stops = [
            { ...tripA.stops[0], stopId: 1, stationCode: "A", name: "A", departureTime: "2024-01-01T10:00:00Z", sequence: 1 },
            { ...tripA.stops[0], stopId: 2, stationCode: "B", name: "B", arrivalTime: "2024-01-01T10:15:00Z", departureTime: "2024-01-01T10:20:00Z", sequence: 2 },
            { ...tripA.stops[0], stopId: 3, stationCode: "C", name: "C", arrivalTime: "2024-01-01T10:30:00Z", departureTime: "2024-01-01T10:35:00Z", sequence: 3 },
            { ...tripA.stops[0], stopId: 4, stationCode: "D", name: "D", arrivalTime: "2024-01-01T10:50:00Z", sequence: 4 }
        ];

        // Mark C and D as cancelled
        tripA.stops[2].changes = [{ changeType: LogicalJourneyPartStationChangeType.CancelledArrival } as any, { changeType: LogicalJourneyPartStationChangeType.CancelledDeparture } as any];
        tripA.stops[3].changes = [{ changeType: LogicalJourneyPartStationChangeType.CancelledArrival } as any, { changeType: LogicalJourneyPartStationChangeType.CancelledDeparture } as any];


        // Trip B: B -> E
        // B departs 10:25 (5 min after A arrives at B)
        const tripB = mockTrip(200, "B", "E", "10:25", "11:00");
        tripB.stops = [
            { ...tripB.stops[0], stopId: 5, stationCode: "B", name: "B", departureTime: "2024-01-01T10:25:00Z", sequence: 1 },
            { ...tripB.stops[0], stopId: 6, stationCode: "E", name: "E", arrivalTime: "2024-01-01T11:00:00Z", sequence: 2 }
        ];

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2); // Merged + Cancelled
        expect(result[0].customRealtimeTripId).toBe("100_200");
    });

    it("should merge trips if the first trip terminates (cancelled departure) at the connection station", () => {
        // Trip A: A -> B. Arrival at B is valid, Departure from B is cancelled.
        // Trip B: B -> C. Starts at B.
        // Should merge at B.

        const tripA = mockTrip(100, "A", "B", "10:00", "10:30");
        // Mark departure at B as cancelled. 
        // Note: mockTrip creates 2 stops. Index 1 is B.
        tripA.stops[1].changes = [{ changeType: LogicalJourneyPartStationChangeType.CancelledDeparture } as any];

        const tripB = mockTrip(200, "B", "C", "10:35", "11:00");

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2); // Merged + Cancelled
        expect(result[0].customRealtimeTripId).toBe("100_200");
    });

    it("should NOT merge trips if they double back to a station already visited", () => {
        // Trip A: Rotterdam (R) -> Dordrecht (D) -> Breda (B)
        // Trip B: Breda (B) -> Dordrecht (D) -> Rotterdam (R)
        // They meet at Breda, but B goes back towards Rotterdam. Should NOT merge.

        const tripA = mockTrip(100, "R", "B", "23:00", "23:45");
        tripA.stops = [
            { ...tripA.stops[0], stationCode: "R", arrivalTime: null, departureTime: "2024-01-01T23:00:00Z", sequence: 1 },
            { ...tripA.stops[0], stationCode: "D", arrivalTime: "2024-01-01T23:15:00Z", departureTime: "2024-01-01T23:16:00Z", sequence: 2 },
            { ...tripA.stops[0], stationCode: "B", arrivalTime: "2024-01-01T23:45:00Z", departureTime: null, sequence: 3 },
        ];

        const tripB = mockTrip(200, "B", "R", "00:00", "00:45");
        tripB.stops = [
            { ...tripB.stops[0], stationCode: "B", arrivalTime: null, departureTime: "2024-01-02T00:00:00Z", sequence: 1 },
            { ...tripB.stops[0], stationCode: "D", arrivalTime: "2024-01-02T00:15:00Z", departureTime: "2024-01-02T00:16:00Z", sequence: 2 },
            { ...tripB.stops[0], stationCode: "R", arrivalTime: "2024-01-02T00:45:00Z", departureTime: null, sequence: 3 },
        ];

        const result = TripMerger.mergeTrips([tripA, tripB]);

        expect(result).toHaveLength(2);
        expect(result[0].customRealtimeTripId).toBeUndefined();
        expect(result[1].customRealtimeTripId).toBeUndefined();
    });
});

function mockTrip(trainNumber: number, startStation: string, endStation: string, startTime: string, endTime: string): IDatabaseRitInfoUpdate {
    // Helper to create simple trips
    return {
        trainNumber,
        shortTrainNumber: trainNumber,
        trainType: "IC",
        agency: "NS",
        showsInTripPlanner: true,
        stops: [
            {
                stopId: 12345,
                sequence: 1,
                arrivalTime: null,
                arrivalDelay: null,
                departureTime: startTime ? `2024-01-01T${startTime}:00Z` : null,
                departureDelay: null,
                plannedArrivalTime: null,
                plannedDepartureTime: startTime ? `2024-01-01T${startTime}:00Z` : null,
                plannedWillStop: true,
                actualWillStop: true,
                destination: endStation,
                stationCode: startStation,
                name: startStation,
                changes: [],
                platform: "1",
                track: "1",
                plannedTrack: "1",
                actualTrack: "1"
            },
            {
                stopId: 67890,
                sequence: 2,
                arrivalTime: endTime ? `2024-01-01T${endTime}:00Z` : null,
                arrivalDelay: null,
                departureTime: null,
                departureDelay: null,
                plannedArrivalTime: endTime ? `2024-01-01T${endTime}:00Z` : null,
                plannedDepartureTime: null,
                plannedWillStop: true,
                actualWillStop: true,
                destination: endStation,
                stationCode: endStation,
                name: endStation,
                changes: [],
                platform: "1",
                track: "1",
                plannedTrack: "1",
                actualTrack: "1"
            }
        ],
        tripId: trainNumber,
        routeId: 1,
        routeType: 1,
        routeLongName: "Route",
        agencyId: "NS",
        directionId: 1,
        shapeId: 1,
        changes: [],
        timestamp: new Date(),
        operationDate: new Date(),
        materialNumbers: ["1234"]
    } as any;
}
