import express, { NextFunction, Request, Response } from "express";
import * as dotenv from "dotenv";
dotenv.config();
import * as bodyParser from "body-parser";
import cors from "cors";
import { Queue, QueueEvents } from "bullmq";

///Set up express and CORS
const app = express();
const port = process.env.PORT;
const allowedOrigins: string[] = ["https://waifus.nemusona.com"];
const options: cors.CorsOptions = {
  origin: allowedOrigins,
};
app.use(cors(options));

/// Set up JSON Parser to handle requests
const jsonParser = bodyParser.json();

/// Settings for queue
const queueLimit = process.env.QUEUE_LIMIT;
const queueDelay = process.env.DELAY;
const queueTimeout = process.env.TIMEOUT;

/// Set up queues
const anythingQueue = new Queue("anything", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const aomQueue = new Queue("aom", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const counterfeitQueue = new Queue("counterfeit", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

/// Set up queue events
const aomEvents = new QueueEvents("aom", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const counterfeitEvents = new QueueEvents("counterfeit", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const anythingEvents = new QueueEvents("anything", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

/// Default settings
const defaults = {
  anything: {
    prompt: "masterpiece, best quality",
    negative_prompt:
      "EasyNegative, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts,signature, watermark, username, blurry, artist name",
    sampler_index: "DPM++ 2M Karras",
    steps: process.env.DEFAULT_STEPS,
    cfg_scale: 7,
    sd_model_checkpoint: "anything-v4.0.ckpt",
    denoising_strength: 0,
  },
  aom: {
    prompt: "",
    negative_prompt: "EasyNegative, (worst quality, low quality:1.4)",
    sampler_index: "DPM++ SDE Karras",
    steps: process.env.DEFAULT_STEPS,
    cfg_scale: 5,
    sd_model_checkpoint: "aom3.safetensors",
    denoising_strength: 0.5,
  },
  counterfeit: {
    prompt: "((masterpiece,best quality))",
    negative_prompt: "EasyNegative, extra fingers,fewer fingers",
    sampler_index: "DPM++ 2M Karras",
    steps: process.env.DEFAULT_STEPS,
    cfg_scale: 10,
    sd_model_checkpoint: "counterfeit-v2.5.safetensors",
    denoising_strength: 0.5,
  },
};

async function getQueue(model: string): Promise<number> | null {
  let result;
  switch (model) {
    case "anything":
      result = await anythingQueue.getJobCounts();
      break;
    case "aom":
      result = await aomQueue.getJobCounts();
      break;
    case "counterfeit":
      result = await counterfeitQueue.getJobCounts();
      break;
    default:
      return null;
  }
  const count =
    Number(result.active) + Number(result.delayed) + Number(result.waiting);
  return count;
}

/// Get status of API
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  return res.status(200).send("API is Alive");
});

/// Get queue from DB
app.get(
  "/queue/:model",
  async (req: Request, res: Response, next: NextFunction) => {
    const model = req.params.model.toLowerCase();
    const count = await getQueue(model);
    if (!count && count !== 0) {
      // Revert if incorrect model
      return res.sendStatus(400);
    } else {
      return res.status(200).send(count.toString());
    }
  }
);

/// Send request to queue
app.post(
  "/generate/:model",
  jsonParser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      /// Get queue
      const model = req.params.model.toLowerCase();
      const count = await getQueue(model);
      if (!count && count !== 0) {
        /// Revert if incorrect model
        return res.sendStatus(400);
      } else if (count > Number(queueLimit)) {
        /// Revert if limit reached
        return res.sendStatus(503);
      }

      /// Load in defaults
      const payload = { ...defaults[model] };

      // Load in settings from request
      const positive = req.body.prompt;
      const negative_prompt = req.body.negative_prompt;
      const cfg_scale = req.body.cfg_scale;
      const denoising_strength = req.body.denoising_strength;
      if (positive) {
        payload.prompt += `, ${positive.toString()}`;
      }
      if (negative_prompt) {
        payload.negative_prompt += `, ${negative_prompt.toString()}`;
      }
      if (cfg_scale) {
        payload.cfg_scale = cfg_scale;
      }
      if (denoising_strength) {
        payload.denoising_strength = denoising_strength;
      }

      let queue: Queue<any, any, string>;
      switch (model) {
        case "anything":
          queue = anythingQueue;
          break;
        case "aom":
          queue = aomQueue;
          break;
        case "counterfeit":
          queue = counterfeitQueue;
          break;
        default:
          return null;
      }

      let queueEvent: QueueEvents;
      switch (model) {
        case "anything":
          queueEvent = anythingEvents;
          break;
        case "aom":
          queueEvent = aomEvents;
          break;
        case "counterfeit":
          queueEvent = counterfeitEvents;
          break;
        default:
          return null;
      }
      if (!queue || !queueEvent) return res.sendStatus(400);

      /// Add to queue
      const job = await queue.add(model, payload, {
        removeOnComplete: Number(queueLimit),
        removeOnFail: Number(queueLimit),
        delay: Number(queueDelay),
      });

      /// Get base64 response from worker
      const base64 = await job.waitUntilFinished(
        queueEvent,
        Number(queueTimeout)
      );

      /// Return base64 to client
      return res.status(200).send(base64.toString());
    } catch (error) {
      return res.sendStatus(500);
    }
  }
);

app.listen(port, () => {
  console.log(`API running on ${port}`);
});
