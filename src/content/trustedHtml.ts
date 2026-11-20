type TrustedHtmlPolicy = {
  createHTML(value: string): unknown;
};

type TrustedTypesLike = {
  createPolicy(name: string, rules: { createHTML(value: string): string }): TrustedHtmlPolicy;
};

let htmlPolicy: TrustedHtmlPolicy | undefined;

function trustedHtml(value: string): string | unknown {
  const trustedTypes = (window as Window & { trustedTypes?: TrustedTypesLike }).trustedTypes;
  if (!trustedTypes) return value;

  htmlPolicy ??= trustedTypes.createPolicy("youmind-html", {
    createHTML: (html) => html
  });
  return htmlPolicy.createHTML(value);
}

export function setTrustedInnerHTML(target: Element | ShadowRoot, value: string): void {
  target.innerHTML = trustedHtml(value) as string;
}

export function setTrustedOuterHTML(target: Element, value: string): void {
  target.outerHTML = trustedHtml(value) as string;
}
