use ika_dwallet_types::{SignedRequestData, UserSignature};
use ika_grpc::UserSignedRequest;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;

pub fn build_grpc_request(payer: &Keypair, request: SignedRequestData) -> UserSignedRequest {
    let signed_data = bcs::to_bytes(&request).expect("BCS serialize");
    let user_sig = UserSignature::Ed25519 {
        signature: vec![0u8; 64],
        public_key: payer.pubkey().to_bytes().to_vec(),
    };
    UserSignedRequest {
        user_signature: bcs::to_bytes(&user_sig).expect("BCS serialize sig"),
        signed_request_data: signed_data,
    }
}
