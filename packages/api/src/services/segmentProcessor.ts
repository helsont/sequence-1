import moment from "moment";
import {
  SegmentIdentify,
  SegmentPage,
  SegmentTrack,
  track,
  identify,
} from "src/events";
import SegmentWebhook from "src/models/segment_webhook";
import SegmentWebook from "../models/segment_webhook";
import WebhookExecution from "../models/webhook_execution";
import Event from "../models/event";
import SequenceError from "src/error/SequenceError";
import logger from "src/utils/logger";
import { HttpResponse } from "src/routes/segment.http";

/**
 * Segment events are saved in the Events table under columns (source, sourceId) = (SEGMENT_WEBHOOK_ID, webhookExecution.id)
 */
export const SEGMENT_WEBHOOK_ID = "segment_webhook";

/**
 * Process events coming from Segment.
 */
class SegmentProcessor {
  /**
   * Entry function for this processor.
   *
   * @param webhook SegmentWebhook
   * @param body Event body
   * @returns
   */
  async process(webhook: SegmentWebhook, body: any) {
    let execution: WebhookExecution;
    try {
      execution = await this.logWebhookEvent(webhook, body);
      await this.handleEvent(body, execution);
    } catch (error) {
      logger.error("SegmentProcess.process:" + error.stack);
      throw new SequenceError("An error occured processing the event", 500);
    }
    return {
      success: true,
    };
  }
  /**
   * Logs the execution of webhook.
   *
   * @param webhook SegmentWebhook
   * @param body Request body
   * @returns WebhookExecution
   */
  async logWebhookEvent(
    webhook: SegmentWebook,
    body: any
  ): Promise<WebhookExecution> {
    await webhook.update({
      execution: webhook.executions + 1,
      lastExecutionAt: new Date(),
    });
    return WebhookExecution.create({
      type: SEGMENT_WEBHOOK_ID,
      payload: body,
      webhookId: webhook.id,
      userId: webhook.userId,
    });
  }
  /**
   * Processes an event from Segment.
   *
   * @param event A Segment event
   * @param webhook WebhookExecution
   * @returns
   */
  async handleEvent(
    event: SegmentIdentify | SegmentTrack | SegmentPage,
    webhook: WebhookExecution
  ): Promise<HttpResponse> {
    if (!event.messageId) {
      logger.info(
        "SegmentProcessor.handleEvent No messageId receieved, skipping"
      );
      throw new Error("No message ID generated by client");
    }

    const existing = await Event.findOne({
      where: {
        userId: webhook.userId,
        messageId: event.messageId,
      },
    });

    if (existing) {
      logger.info(
        "SegmentProcessor.handleEvent Duplicate messageId receieved, skipping: " +
          event.messageId
      );
      return {
        success: true,
        processed: false,
      };
    }

    if (event.type === "identify") {
      // not yet supported
      if (
        event.anonymousId &&
        (typeof event.userId === "undefined" || !event.userId)
      ) {
        logger.info(
          "SegmentProcessor.handleEvent Received anonymousId identify, skipping: " +
            event.anonymousId
        );
        return {
          success: true,
          processed: false,
        };
      }

      await identify(
        {
          type: "identify",
          traits: event.traits,
          userId: event.userId,
          context: event.context,
          messageId: event.messageId,
          receivedAt: new Date(),
          sentAt: moment(event.sentAt).toDate(),
          timestamp: moment(event.timestamp).toDate(),
        },
        {
          userId: webhook.userId,
        }
      );
    } else if (event.type === "track") {
      await track(
        {
          type: "track",
          event: event.event,
          userId: event.userId,
          context: event.context,
          messageId: event.messageId,
          properties: event.properties,
          receivedAt: new Date(),
          sentAt: moment(event.sentAt).toDate(),
          timestamp: moment(event.timestamp).toDate(),
        },
        {
          userId: webhook.userId,
          source: webhook.type,
          sourceId: webhook.id,
        }
      );
    }
    return {
      success: true,
      processed: true,
    };
  }
}

export default SegmentProcessor;