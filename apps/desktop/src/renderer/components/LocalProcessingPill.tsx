import { Tag, Tooltip } from '@blueprintjs/core'

export type RanOn = 'local' | 'anthropic_api'

/** Assurant track: always say where an AI step ran. */
export function LocalProcessingPill({ ranOn }: { ranOn: RanOn }) {
  return ranOn === 'local' ? (
    <Tooltip content="Processed on this machine. Frames and images never leave it." compact>
      <Tag minimal round icon="shield" intent="success">
        On this device
      </Tag>
    </Tooltip>
  ) : (
    <Tooltip
      content="Text only is sent to the Anthropic API (BAA required in production). No images."
      compact
    >
      <Tag minimal round icon="cloud">
        Cloud model, text only
      </Tag>
    </Tooltip>
  )
}
