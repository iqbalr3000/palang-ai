export interface InjectionClassifier {
  /** Probability in 0..1 that `text` is a prompt injection. Rejects if the model can't run. */
  classify(text: string, signal?: AbortSignal): Promise<number>;
}
