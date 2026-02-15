/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */

import { Repository } from "./Repository";
import { IDatabaseRitInfoUpdate } from "../Interfaces/DatabaseRitInfoUpdate";
import { IInfoPlusRepository } from "../Interfaces/Repositories/InfoplusRepository";

export class InfoplusRepository extends Repository implements IInfoPlusRepository {

    /** @inheritDoc */
    public async getCurrentRealtimeTripUpdates(operationDateOfTodayOrYesterday: string, operationDateOfTodayOrTomorrow: string, endOperationDate: string): Promise<IDatabaseRitInfoUpdate[]> {
        console.time('getCurrentRealtimeTripUpdates');
        return this.database.raw(`
            WITH journey_part_first_stops AS (
            SELECT DISTINCT ON (si."journeyNumber", si."journeyPartNumber", si."operationDate")
                si."journeyNumber",
                si."journeyPartNumber",
                si."operationDate",
                si."stationCode" AS first_station_code
            FROM "InfoPlus-new".stop_information si
            WHERE si."stopType" != 'N'
              AND (si."plannedWillStop" = true OR si."actualWillStop" = true)
            ORDER BY si."journeyNumber", si."journeyPartNumber", si."operationDate", si."stopOrder"
                ),
                material_parts_agg AS (
            SELECT "journeyPartNumber", "operationDate", array_remove(array_agg(distinct "shortMaterialNumber"), NULL) AS "materialNumbers", "travelInformationProductId"
            FROM "InfoPlus-new".material_parts
            GROUP BY "journeyPartNumber", "operationDate", "travelInformationProductId"
                )
            SELECT jpjl."journeyPartNumber"                                                              AS "trainNumber",
                   jpjl."shortJourneyPartNumber"                                                         AS "shortTrainNumber",
                   r."trainType" ->> 'code'                                                              AS "trainType",
                r.agency,
                r."operationDate",
                r."showsInTravelPlanner"                                                              AS "showsInTripPlanner",
                r."timestamp",
                coalesce(lj."journeyChanges", jpjl."journeyPartChanges")                              AS "changes",
                t."tripId"                                                                            AS "tripId",
                coalesce(t."routeId", t_short."routeId")                                              AS "routeId",
                rt."routeType"                                                                        AS "routeType",
                rt."agencyId"                                                                         AS "agencyId",
                rt."routeLongName"                                                                    AS "routeLongName",
                coalesce(t."directionId", t_short."directionId")                                      AS "directionId",
                COALESCE(MIN(mp."materialNumbers"), ARRAY[]::varchar[])                               AS "materialNumbers",
                coalesce(t."shapeId", t_short."shapeId")                                              AS "shapeId",
                jsonb_agg(
                CASE
                WHEN s."stopId" IS NOT NULL OR lateral_stop."stopId" IS NOT NULL THEN
                jsonb_build_object(
                'stationCode', si."stationCode",
                'plannedWillStop', si."plannedWillStop",
                'actualWillStop', si."actualWillStop",
                'plannedArrivalTime', si."plannedArrivalTime",
                'plannedDepartureTime', si."plannedDepartureTime",
                'departureTime', coalesce(si."actualDepartureTime", si."plannedDepartureTime"),
                'arrivalTime', coalesce(si."actualArrivalTime", si."plannedArrivalTime"),
                'departureDelay', si."actualDepartureTime" - si."plannedDepartureTime",
                'arrivalDelay', si."actualArrivalTime" - si."plannedArrivalTime",
                'changes', si.changes,
                'stopId', COALESCE(s."stopId", lateral_stop."stopId"),
                'platform', s."platformCode",
                'plannedTrack', coalesce(si."plannedArrivalTracks", si."plannedDepartureTracks"),
                'actualTrack', coalesce(si."actualArrivalTracks", si."actualDepartureTracks"),
                'track',
                coalesce(si."actualArrivalTracks", si."actualDepartureTracks", si."plannedArrivalTracks",
                si."plannedDepartureTracks"),
                'sequence', si."stopOrder",
                'name', COALESCE(s."stopName", lateral_stop."stopName", si."stationCode"),
                'destination', stat."longName"
                )
                END
                ORDER BY si."stopOrder"
                ) FILTER (WHERE s."stopId" IS NOT NULL OR lateral_stop."stopId" IS NOT NULL) AS stops
            FROM "InfoPlus-new".ritinfo r
                JOIN "InfoPlus-new".logical_journeys lj
            ON r."trainNumber" = lj."trainNumber" AND r."operationDate" = lj."operationDate"
                JOIN "InfoPlus-new".logical_journey_parts jpjl
                ON lj."journeyNumber" = jpjl."journeyNumber" AND
                r."operationDate" = jpjl."operationDate"
                JOIN "InfoPlus-new".stop_information si
                ON jpjl."journeyNumber" = si."journeyNumber" AND
                jpjl."journeyPartNumber" = si."journeyPartNumber" AND
                jpjl."operationDate" = si."operationDate" AND
                si."stopType" != 'N' AND
                ("plannedWillStop" = true OR "actualWillStop" = true) AND
                (coalesce("plannedDepartureTime", "actualArrivalTime") IS NOT NULL OR
                coalesce("plannedArrivalTime", "actualArrivalTime") IS NOT NULL)
                JOIN "InfoPlus-new".destinations dest
                ON si."journeyNumber" = dest."journeyNumber" AND
                si."journeyPartNumber" = dest."journeyPartNumber" AND
                si."operationDate" = dest."operationDate" AND
                si."stationCode" = dest."stationCode"
                JOIN "InfoPlus-new".stations stat ON stat."stationCode" = coalesce(dest."actualDestination", dest."plannedDestination")
                LEFT JOIN journey_part_first_stops jpfs
                ON jpfs."journeyNumber" = jpjl."journeyNumber"
                AND jpfs."journeyPartNumber" = jpjl."journeyPartNumber"
                AND jpfs."operationDate" = jpjl."operationDate"

                -- Optimization: Use Materialized View for Trip Lookup
                LEFT JOIN "StaticData-NL".mv_active_schedule t
                ON t.trip_number = jpjl."journeyPartNumber"
                AND t.date = r."operationDate"
                AND t.first_station_code = jpfs.first_station_code

                LEFT JOIN "StaticData-NL".mv_active_schedule t_short
                ON t_short.trip_number = jpjl."shortJourneyPartNumber"
                AND t_short.date = r."operationDate"
                AND t_short.first_station_code = jpfs.first_station_code
                AND t."tripId" IS NULL

                -- Optimization: Use Materialized View for Stops Lookup
                LEFT JOIN "StaticData-NL".iff_stops s ON (s."stationCode" = si."stationCode" AND
                s."platformCode" =
                coalesce(si."actualArrivalTracks", si."actualDepartureTracks", si."plannedArrivalTracks",
                si."plannedDepartureTracks"))
                LEFT JOIN LATERAL (
                SELECT "stopId", "stopName"
                FROM "StaticData-NL".iff_stops lax
                WHERE lax."stationCode" = si."stationCode"
                LIMIT 1
                ) AS lateral_stop ON s."stopId" IS NULL

                LEFT JOIN "StaticData-NL".routes rt ON rt."routeId" = coalesce(t."routeId", t_short."routeId")

                -- Use CTE for material parts to PREVENT DUPLICATE STOPS (Cartesian product)
                LEFT JOIN material_parts_agg mp ON mp."journeyPartNumber" = jpjl."journeyPartNumber" AND mp."operationDate" = jpjl."operationDate" AND mp."travelInformationProductId" = r."travelInformationProductId"

            WHERE r."operationDate" >= :operationDateOfTodayOrYesterday::date
              AND NOT (
                r."operationDate" > :operationDateOfTodayOrTomorrow::date
              AND lj."journeyChanges" IS NULL
                )
            GROUP BY r."trainNumber", jpjl."journeyNumber", jpjl."journeyPartNumber", r."shortTrainNumber", jpjl."shortJourneyPartNumber",
                r."trainType", r.agency,
                r."showsInTravelPlanner", r.timestamp, r."operationDate", t."tripId", coalesce(t."tripId", t_short."tripId"),
                coalesce(lj."journeyChanges", jpjl."journeyPartChanges"),
                t."tripId", coalesce(t."routeId", t_short."routeId"),
                coalesce(t."directionId", t_short."directionId"), coalesce(t."shapeId", t_short."shapeId"), rt."routeType",
                rt."agencyId", rt."routeLongName";
        `, { operationDateOfTodayOrYesterday, endOperationDate, operationDateOfTodayOrTomorrow }).then(result => {
            console.timeEnd('getCurrentRealtimeTripUpdates');
            return result.rows;
        }).catch(error => {
            console.error(error);
            throw error;
        });
    }

    /**
     * Fetches all trip ids for TVV train numbers that are in the StaticData-NL.trips table but not in the InfoPlus.ritInfo table.
     * @param TVVTrainNumbers The TVV train numbers to check.
     * @param date The date to check for.
     */
    public async getTripIdsForTVVNotInInfoPlus(TVVTrainNumbers: number[], date: string): Promise<number[]> {
        if (TVVTrainNumbers.length === 0)
            return [];

        const trainNumberPlaceHolders = TVVTrainNumbers.map(() => "?").join(",")

        return this.database
            .raw(`SELECT DISTINCT "tripId"
                  FROM "StaticData-NL".trips
                  WHERE "journeyNumber" NOT IN
                        (SELECT DISTINCT "trainNumber"
                         FROM "InfoPlus-new".ritInfo
                         WHERE "trainNumber" IN (${trainNumberPlaceHolders})
                           AND "operationDate" = ?)
                    AND "journeyNumber" IN (${trainNumberPlaceHolders})`, [...TVVTrainNumbers, date, ...TVVTrainNumbers])
            .then(result => result.rows.map((row: { tripId: number }) => row.tripId));
    }
}
