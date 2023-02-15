import express, { Request, Response } from "express";
import * as dotenv from "dotenv";
dotenv.config();
import * as bodyParser from "body-parser";
import cors from "cors";
import { Queue, QueueEvents, Worker } from "bullmq";

const app = express();
const port = process.env.PORT;
const SD = process.env.SD;
const defaultPayload = {
  prompt: process.env.DEFAULT_PROMPT,
  negative_prompt: process.env.DEFAULT_NEGATIVE_PROMPT,
  sampler_index: process.env.DEFAULT_SAMPLER,
  steps: process.env.DEFAULT_STEPS,
  cfg_scale: process.env.DEFAULT_CFG_SCALE,
  sd_model_checkpoint: process.env.DEFAULT_CHECKPOINT,
  denoising_strength: process.env.DEFAULT_DENOISE_STRENGTH,
};
const jsonParser = bodyParser.json();
const allowedOrigins: string[] = [
  "https://waifus.nemusona.com",
  "localhost:3000",
];
const options: cors.CorsOptions = {
  origin: allowedOrigins,
};
app.use(cors(options));

const queue = new Queue("gen", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const queueEvents = new QueueEvents("gen", {
  connection: {
    host: process.env.REDIS_URL,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASS,
  },
});

const worker = new Worker(
  "gen",
  async (job) => {
    const aaa = await fetch(`${SD}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(job.data),
    });
    if (aaa.status === 200) {
      const json = await aaa.json();
      const base64 = json.images[0];
      return base64;
    } else {
      throw new Error("Server Error");
    }
  },
  {
    concurrency: 1,
    connection: {
      host: process.env.REDIS_URL,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASS,
    },
  }
);

app.get("/", (req: Request, res: Response) => {
  return res.status(200).send("API is Alive");
});

app.get("/queue", async (req: Request, res: Response) => {
  const count = await queue.getJobCounts();
  return res.status(200).send(count);
});

app.post(
  "/generate",
  jsonParser,
  async (req: Request, res: express.Response) => {
    const start = Number(new Date());
    const result = await queue.getJobCounts();
    const count =
      Number(result.active) + Number(result.delayed) + Number(result.waiting);
    console.log(`request received. queue: ${count}`);
    const payload = { ...defaultPayload };
    try {
      if (count > 35) {
        return res.status(503).send("Cannot process request");
      }
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
      const job = await queue.add("prompts", payload, {
        removeOnComplete: true,
        removeOnFail: true,
      });
      const base64 = await job.waitUntilFinished(queueEvents, 120000);
      const buffer = Buffer.from(base64, "base64");
      res.set({ "Content-Type": "image/png" });
      const end = Number(new Date());
      console.log(
        `success. elapsed: ${end - start}ms. queue when started: ${count}`
      );
      return res.status(200).send(buffer);
    } catch (error) {
      console.log(error);
      const end = Number(new Date());
      console.log(
        `failed. elapsed: ${end - start}ms. queue when started: ${count}`
      );
      return res.status(500).send("Server Error");
    }
  }
);

app.listen(port, () => {
  console.log(`Running on port ${port}`);
});
