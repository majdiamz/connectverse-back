const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v18.0';
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;

export interface FacebookUserProfile {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}

export interface FacebookSendMessageResponse {
  recipient_id: string;
  message_id: string;
}

export interface FacebookPageInfo {
  id: string;
  name: string;
}

export interface FacebookError {
  message: string;
  type: string;
  code: number;
  fbtrace_id: string;
}

interface FacebookErrorResponse {
  error: FacebookError;
}

/**
 * Send a text message to a Facebook Messenger user
 */
export async function sendMessage(
  recipientId: string,
  message: string,
  pageAccessToken: string
): Promise<FacebookSendMessageResponse> {
  const url = `${FACEBOOK_GRAPH_URL}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      messaging_type: 'RESPONSE',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json() as FacebookErrorResponse;
    throw new Error(`Facebook API error: ${errorData.error.message} (code: ${errorData.error.code})`);
  }

  return await response.json() as FacebookSendMessageResponse;
}

/**
 * Get a user's profile from Facebook
 */
export async function getUserProfile(
  psid: string,
  pageAccessToken: string
): Promise<FacebookUserProfile> {
  const fields = 'id,name,first_name,last_name,profile_pic';
  const url = `${FACEBOOK_GRAPH_URL}/${psid}?fields=${fields}&access_token=${encodeURIComponent(pageAccessToken)}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json() as FacebookErrorResponse;
    throw new Error(`Facebook API error: ${errorData.error.message} (code: ${errorData.error.code})`);
  }

  return await response.json() as FacebookUserProfile;
}

/**
 * Validate a Page Access Token and get the Page ID
 */
export async function validatePageAccessToken(
  pageAccessToken: string
): Promise<FacebookPageInfo> {
  const url = `${FACEBOOK_GRAPH_URL}/me?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json() as FacebookErrorResponse;
    throw new Error(`Invalid Page Access Token: ${errorData.error.message}`);
  }

  return await response.json() as FacebookPageInfo;
}
