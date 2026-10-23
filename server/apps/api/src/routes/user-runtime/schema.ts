import {
  array,
  boolean,
  check,
  maxLength,
  maxValue,
  minLength,
  minValue,
  nullable,
  number,
  object,
  optional,
  picklist,
  pipe,
  record,
  string,
  unknown,
} from 'valibot'

const shortText = (max = 256) => pipe(string(), maxLength(max))
const finiteNumber = pipe(number(), check(value => Number.isFinite(value), 'expected a finite number'))

export const RuntimeTimestampSchema = pipe(
  string(),
  check(value => Number.isFinite(Date.parse(value)), 'expected an ISO timestamp'),
)

const TimedSpeechSchema = object({
  provider: shortText(),
  model: shortText(),
  voiceId: shortText(),
  pitch: finiteNumber,
  rate: finiteNumber,
  ssml: boolean(),
  updatedAt: RuntimeTimestampSchema,
})

const CardOverrideSchema = object({
  cardId: pipe(string(), minLength(1), maxLength(128)),
  speech: optional(TimedSpeechSchema),
  scene: optional(object({
    backgroundId: pipe(string(), maxLength(128)),
    updatedAt: RuntimeTimestampSchema,
  })),
  displayModel: optional(object({
    modelId: pipe(string(), maxLength(256)),
    updatedAt: RuntimeTimestampSchema,
    llmMode: optional(picklist(['all', 'none', 'custom'])),
    llmExposed: optional(record(shortText(64), boolean())),
    defaults: optional(record(shortText(128), finiteNumber)),
    values: optional(record(shortText(128), finiteNumber)),
    activeGroups: optional(record(shortText(64), boolean())),
  })),
})

const SceneBackgroundSchema = object({
  id: pipe(string(), minLength(1), maxLength(128)),
  title: pipe(string(), maxLength(200)),
  mimeType: pipe(string(), maxLength(100)),
  data: pipe(string(), maxLength(600_000)),
  updatedAt: RuntimeTimestampSchema,
  deletedAt: optional(RuntimeTimestampSchema),
})

const modelParameter = finiteNumber

export const AccountSectionsSchema = pipe(
  object({
    modules: optional(object({
      updatedAt: RuntimeTimestampSchema,
      consciousness: object({
        provider: shortText(),
        model: shortText(),
        customModel: shortText(),
        reasoning: boolean(),
      }),
      hearing: object({
        provider: shortText(),
        model: shortText(),
        customModel: shortText(),
        autoSendEnabled: boolean(),
        autoSendDelay: pipe(finiteNumber, minValue(0), maxValue(120_000)),
        confidenceThreshold: pipe(finiteNumber, minValue(-10), maxValue(1)),
      }),
      vision: object({
        provider: shortText(),
        model: shortText(),
        customModel: shortText(),
        ollamaThinkingEnabled: boolean(),
      }),
      webSearch: object({
        enabled: boolean(),
        apiKey: pipe(string(), maxLength(4_096)),
      }),
      artistry: object({
        provider: shortText(),
        model: shortText(),
        promptPrefix: pipe(string(), maxLength(4_000)),
        comfyuiServerUrl: pipe(string(), maxLength(2_000)),
        comfyuiActiveWorkflow: shortText(),
        replicateApiKey: pipe(string(), maxLength(4_096)),
        replicateDefaultModel: shortText(),
        replicateAspectRatio: shortText(32),
        replicateInferenceSteps: pipe(finiteNumber, minValue(1), maxValue(100)),
        nanobananaApiKey: pipe(string(), maxLength(4_096)),
        nanobananaModel: shortText(),
        nanobananaResolution: shortText(32),
      }),
      discord: object({
        enabled: boolean(),
        token: pipe(string(), maxLength(4_096)),
      }),
      twitter: object({
        enabled: boolean(),
        apiKey: pipe(string(), maxLength(4_096)),
        apiSecret: pipe(string(), maxLength(4_096)),
        accessToken: pipe(string(), maxLength(4_096)),
        accessTokenSecret: pipe(string(), maxLength(4_096)),
      }),
      factorio: object({
        enabled: boolean(),
        serverAddress: pipe(string(), maxLength(2_000)),
        serverPort: nullable(pipe(finiteNumber, minValue(0), maxValue(65_535))),
        username: shortText(),
      }),
      mcp: object({
        serverCmd: pipe(string(), maxLength(1_024)),
        serverArgs: pipe(string(), maxLength(4_096)),
      }),
      beatSync: object({
        spectrumScale: picklist(['linear', 'logarithm']),
      }),
    })),
    knowledgeBase: optional(object({
      updatedAt: RuntimeTimestampSchema,
      connections: pipe(array(object({
        id: pipe(string(), minLength(1), maxLength(64)),
        name: pipe(string(), maxLength(200)),
        baseUrl: pipe(string(), maxLength(2_000)),
        apiKey: pipe(string(), maxLength(4_096)),
        knowledgeBaseId: pipe(string(), maxLength(256)),
        enabled: boolean(),
      })), maxLength(20)),
    })),
    connection: optional(object({
      updatedAt: RuntimeTimestampSchema,
      websocketUrl: pipe(string(), maxLength(2_000)),
      websocketSecure: boolean(),
    })),
    system: optional(object({
      updatedAt: RuntimeTimestampSchema,
      language: shortText(32),
      disableTransitions: boolean(),
      usePageSpecificTransitions: boolean(),
      themeColorsHue: pipe(finiteNumber, minValue(0), maxValue(360)),
      themeColorsHueDynamic: boolean(),
      analyticsEnabled: boolean(),
    })),
    modelView: optional(object({
      updatedAt: RuntimeTimestampSchema,
      position: object({ x: finiteNumber, y: finiteNumber }),
      scale: pipe(finiteNumber, minValue(0.01), maxValue(3)),
      currentMotion: object({
        group: shortText(),
        index: optional(pipe(finiteNumber, minValue(0), maxValue(10_000))),
      }),
      modelParameters: object({
        angleX: modelParameter,
        angleY: modelParameter,
        angleZ: modelParameter,
        leftEyeOpen: modelParameter,
        rightEyeOpen: modelParameter,
        leftEyeSmile: modelParameter,
        rightEyeSmile: modelParameter,
        leftEyebrowLR: modelParameter,
        rightEyebrowLR: modelParameter,
        leftEyebrowY: modelParameter,
        rightEyebrowY: modelParameter,
        leftEyebrowAngle: modelParameter,
        rightEyebrowAngle: modelParameter,
        leftEyebrowForm: modelParameter,
        rightEyebrowForm: modelParameter,
        mouthOpen: modelParameter,
        mouthForm: modelParameter,
        cheek: modelParameter,
        bodyAngleX: modelParameter,
        bodyAngleY: modelParameter,
        bodyAngleZ: modelParameter,
        breath: modelParameter,
      }),
      eyeTracking: boolean(),
      eyeOffset: object({ x: finiteNumber, y: finiteNumber }),
      idleAnimation: boolean(),
      idleEyeAnimation: boolean(),
      autoBlink: boolean(),
      forceAutoBlink: boolean(),
      expression: boolean(),
      shadow: boolean(),
      maxFps: pipe(finiteNumber, minValue(0), maxValue(240)),
      renderScale: pipe(finiteNumber, minValue(0.1), maxValue(4)),
      motionDriver: picklist(['magic', 'universal']),
      spinePremultipliedAlpha: boolean(),
      spineDefaultMix: pipe(finiteNumber, minValue(0), maxValue(10)),
      spineIdleEnabled: boolean(),
      spineMaxFps: pipe(finiteNumber, minValue(0), maxValue(240)),
      spineRenderScale: pipe(finiteNumber, minValue(0.1), maxValue(4)),
    })),
    cardOverrides: optional(pipe(array(CardOverrideSchema), maxLength(32))),
    scenes: optional(pipe(array(SceneBackgroundSchema), maxLength(4))),
    modelExpressions: optional(pipe(array(object({
      modelId: pipe(string(), minLength(1), maxLength(256)),
      updatedAt: RuntimeTimestampSchema,
      llmMode: picklist(['all', 'none', 'custom']),
      llmExposed: record(shortText(64), boolean()),
      defaults: record(shortText(128), finiteNumber),
      values: record(shortText(128), finiteNumber),
      activeGroups: optional(record(shortText(64), boolean())),
    })), maxLength(32))),
  }),
  check(value => JSON.stringify(value).length <= 700_000, 'sections are too large'),
)

export const SaveRuntimeSettingsSchema = object({
  activeCardId: pipe(string(), minLength(1), maxLength(128)),
  activeCardUpdatedAt: RuntimeTimestampSchema,
  profileContent: pipe(string(), maxLength(20_000)),
  profileUpdatedAt: RuntimeTimestampSchema,
  sections: optional(AccountSectionsSchema),
})

export const SaveRuntimeCardSchema = object({
  updatedAt: RuntimeTimestampSchema,
  card: unknown(),
})

export const DeleteRuntimeCardSchema = object({
  updatedAt: RuntimeTimestampSchema,
})

export const RuntimeCardIdSchema = pipe(string(), minLength(1), maxLength(128))
