import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

export const langfuseSdk = new NodeSDK({
  spanProcessors: [
    new LangfuseSpanProcessor({
      shouldExportSpan: ({ otelSpan }) => {
        // console.log(
        //   'Span scope:',
        //   otelSpan.instrumentationScope?.name,
        //   '| Span name:',
        //   otelSpan.name
        // );

        // 只上报手动创建的 span，过滤掉自动 instrumentations 产生的 HTTP/API span
        const scopeName = otelSpan.instrumentationScope?.name || '';
        if (scopeName !== 'langfuse-sdk') {
          return false;
        }

        return true;
      }
    })
  ],
  instrumentations: [] // 显式设置空数组，禁用所有自动 instrumentation
});

langfuseSdk.start();
