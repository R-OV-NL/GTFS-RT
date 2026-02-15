/*
 * Copyright (c) 2023. R-OV / Tristan van Triest
 * This file is part of the R-OV source code and thus shall not be shared. Please respect the copyright of the original owner.
 * Questions? Email: tristantriest@gmail.com
 */
import { TrainUpdateCollection } from "../Models/TrainUpdateCollection";
import { LogicalJourneyChangeType } from "../Shared/src/Types/Infoplus/V2/Changes/LogicalJourneyChangeType";
import { IDatabaseRitInfoUpdate } from "../Interfaces/DatabaseRitInfoUpdate";

import { TripIdWithDate } from "../Interfaces/TVVManager";
import { TripMerger } from "../Helpers/TripMerger";

import { transit_realtime } from "../Compiled/compiled";
import { IInfoPlusRepository } from "../Interfaces/Repositories/InfoplusRepository";
import { IFeedManager } from "../Interfaces/Services/UpdateTrainFeed";
import FeedMessage = transit_realtime.FeedMessage;
import moment from "moment-timezone";

/**
 * Singleton class that handles updating (for now only) the train feed.
 * @Singleton
 */
export class FeedManager implements IFeedManager {

    private static instance: FeedManager | null;
    private readonly _infoplusRepository: IInfoPlusRepository;

    private constructor(infoPlusRepository: IInfoPlusRepository) {
        this._infoplusRepository = infoPlusRepository;
    }

    public static getInstance(infoPlusRepository: IInfoPlusRepository): FeedManager {
        if (!this.instance) {
            this.instance = new FeedManager(infoPlusRepository);
        }
        return this.instance;
    }

    public async updateTrainFeed(tripIdsToRemove: TripIdWithDate[]): Promise<void> {
        console.time('Updating train feed...');
        console.log('Updating train feed...')
        //Get the current operationDate in YYYY-MM-DD format
        const currentOperationDate = moment()
            .tz('Europe/Amsterdam')
            .format('YYYY-MM-DD');

        const operationDateTomorrow = moment(currentOperationDate)
            .add(1, 'days')
            .format('YYYY-MM-DD')

        const operationDateYesterday = moment(currentOperationDate)
            .subtract(1, 'days')
            .format('YYYY-MM-DD')

        //Get the operationDate 3 days from now in YYYY-MM-DD format
        const endOperationDate = moment(currentOperationDate)
            .add(3, 'days')
            .format('YYYY-MM-DD')

        let operationDateOfTodayOrTomorrow = currentOperationDate;
        let operationDateOfYesterdayOrToday = currentOperationDate;

        //Check if the current time is between 00:00 and 04:00, if so, set the current operationDate to yesterday.
        if (moment().tz('Europe/Amsterdam').hour() < 4) {
            operationDateOfYesterdayOrToday = operationDateYesterday;
        }

        //Check if the current time is after 22:00, if so, set the current operationDate to tomorrow.
        if (moment().tz('Europe/Amsterdam').hour() >= 22) {
            operationDateOfTodayOrTomorrow = operationDateTomorrow;
        }

        console.time('Getting realtime trip updates from database...')
        const trainUpdates = await this._infoplusRepository.getCurrentRealtimeTripUpdates(
            operationDateOfYesterdayOrToday,
            operationDateOfTodayOrTomorrow,
            endOperationDate
        );
        console.timeEnd('Getting realtime trip updates from database...')

        const mergedUpdates = TripMerger.mergeTrips(trainUpdates);

        const trainUpdateCollection = TrainUpdateCollection.fromDatabaseResult(mergedUpdates);

        trainUpdateCollection.applyRemovals(tripIdsToRemove);
        trainUpdateCollection.checkForErrors();
        const trainUpdateFeed: FeedMessage = trainUpdateCollection.toFeedMessage();

        try {
            const constructedFeedMessage: FeedMessage = FeedMessage.fromObject(trainUpdateFeed);
            console.log(`[FeedManager] Constructed feed message with ${constructedFeedMessage.entity.length} entities.`);

            this.saveToFile(Buffer.from(FeedMessage.encode(constructedFeedMessage).finish()), 'trainUpdates.pb');
            this.saveToFile(Buffer.from(JSON.stringify(constructedFeedMessage.toJSON())), 'trainUpdates.json');
        } catch (e) {
            console.error(`[FeedManager] Error while saving train feed`, e);
        }

        console.timeEnd('Updating train feed...');
    }

    private saveToFile(buffer: Buffer, fileName: string): void {
        // @ts-ignore
        Bun.write(`./publish/${fileName}`, buffer);

        console.log(`[FeedManager] Saved updates to ${fileName}`);
    }


}
