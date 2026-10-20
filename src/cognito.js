import { CognitoUserPool } from "amazon-cognito-identity-js";

const poolData = {
  UserPoolId: "eu-north-1_OgXHqPCxJ",
  ClientId: "53ndbudm8a68k340idie9hqgnd",
};

export const userPool = new CognitoUserPool(poolData);