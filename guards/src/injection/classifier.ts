export interface InjectionClassifier {
  classify(text: string, signal?: AbortSignal): Promise<number>;
}
