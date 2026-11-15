use anyhow::{Result, anyhow, ensure};
use opaque_ke::{
    CipherSuite, ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialFinalization, CredentialRequest,
    CredentialResponse, ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand::{Rng, rngs::OsRng};
use rcgen::{
    BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose,
};
use rustls::{
    ClientConfig, RootCertStore, ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    server::WebPkiClientVerifier,
};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const SERVER_NAME: &str = "device.syncfu.local";

pub struct Identity {
    ca: Vec<u8>,
    leaf: Vec<u8>,
    key: Vec<u8>,
}

impl Identity {
    pub fn generate() -> Result<Self> {
        let ca_key = KeyPair::generate()?;
        let mut ca_params = CertificateParams::default();
        ca_params.distinguished_name.push(
            rcgen::DnType::CommonName,
            format!("SyncFu {}", uuid::Uuid::new_v4()),
        );
        ca_params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
        ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let ca = ca_params.self_signed(&ca_key)?;
        let key = KeyPair::generate()?;
        let mut params = CertificateParams::new(vec![SERVER_NAME.to_owned()])?;
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![
            ExtendedKeyUsagePurpose::ServerAuth,
            ExtendedKeyUsagePurpose::ClientAuth,
        ];
        let leaf = params.signed_by(&key, &ca, &ca_key)?;
        Ok(Self {
            ca: ca.der().to_vec(),
            leaf: leaf.der().to_vec(),
            key: key.serialize_der(),
        })
    }

    pub fn from_secret_bytes(mut bytes: &[u8]) -> Result<Self> {
        let mut parts = Vec::new();
        for _ in 0..3 {
            let prefix = bytes.get(..2).ok_or_else(|| anyhow!("设备身份格式无效"))?;
            let len = usize::from(u16::from_be_bytes([prefix[0], prefix[1]]));
            bytes = &bytes[2..];
            ensure!(len > 0 && len <= bytes.len(), "设备身份格式无效");
            parts.push(bytes[..len].to_vec());
            bytes = &bytes[len..];
        }
        let [ca, leaf, key] =
            <[Vec<u8>; 3]>::try_from(parts).map_err(|_| anyhow!("设备身份格式无效"))?;
        ensure!(bytes.is_empty(), "设备身份格式无效");
        Ok(Self { ca, leaf, key })
    }

    pub fn secret_bytes(&self) -> Result<Vec<u8>> {
        let mut bytes = Vec::new();
        for part in [&self.ca, &self.leaf, &self.key] {
            bytes.extend(u16::try_from(part.len())?.to_be_bytes());
            bytes.extend(part);
        }
        Ok(bytes)
    }
    pub fn cert_der(&self) -> &[u8] {
        &self.ca
    }
    pub fn leaf_der(&self) -> &[u8] {
        &self.leaf
    }
    pub fn id(&self) -> String {
        hex::encode(Sha256::digest(&self.ca))
    }

    fn certs(&self) -> Vec<CertificateDer<'static>> {
        vec![CertificateDer::from(self.leaf.clone())]
    }
    fn key(&self) -> PrivateKeyDer<'static> {
        PrivatePkcs8KeyDer::from(self.key.clone()).into()
    }
    pub fn server_config(
        &self,
        trusted: &[Vec<u8>],
        allow_unpaired: bool,
    ) -> Result<Arc<ServerConfig>> {
        let base =
            ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_protocol_versions(&[&rustls::version::TLS13])?;
        let base = if trusted.is_empty() {
            ensure!(allow_unpaired, "当前没有可连接的设备");
            base.with_no_client_auth()
        } else {
            let mut roots = RootCertStore::empty();
            for cert in trusted {
                roots.add(CertificateDer::from(cert.clone()))?;
            }
            let verifier = WebPkiClientVerifier::builder_with_provider(
                Arc::new(roots),
                Arc::new(rustls::crypto::ring::default_provider()),
            );
            let verifier = if allow_unpaired {
                verifier.allow_unauthenticated()
            } else {
                verifier
            };
            base.with_client_cert_verifier(verifier.build()?)
        };
        let mut config = base.with_single_cert(self.certs(), self.key())?;
        config.send_tls13_tickets = 0;
        Ok(Arc::new(config))
    }

    pub fn client_config(&self, peer_ca: &[u8], send_identity: bool) -> Result<Arc<ClientConfig>> {
        let mut roots = RootCertStore::empty();
        roots.add(CertificateDer::from(peer_ca.to_owned()))?;
        let base =
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_protocol_versions(&[&rustls::version::TLS13])?
                .with_root_certificates(roots);
        let config = if send_identity {
            base.with_client_auth_cert(self.certs(), self.key())?
        } else {
            base.with_no_client_auth()
        };
        Ok(Arc::new(config))
    }
}

struct Suite;
impl CipherSuite for Suite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf = argon2::Argon2<'static>;
}

pub struct Invite {
    session: String,
    code: String,
    expiry: Instant,
    expiry_ms: u64,
    setup: ServerSetup<Suite>,
    registration: Vec<u8>,
    attempts: u8,
    active: bool,
    consumed: bool,
}
pub struct ServerHandshake {
    session: String,
    state: ServerLogin<Suite>,
    context: Vec<u8>,
}
pub struct ClientHandshake {
    state: ClientLogin<Suite>,
    code: String,
}

fn auth<T, E>(result: std::result::Result<T, E>) -> Result<T> {
    result.map_err(|_| anyhow!("动态码错误或配对认证失败"))
}

impl Invite {
    pub fn new() -> Result<Self> {
        let mut rng = OsRng;
        let code = format!("{:05}", rng.gen_range(0..100_000));
        let session = uuid::Uuid::new_v4().to_string();
        let setup = ServerSetup::new(&mut rng);
        let first = auth(ClientRegistration::<Suite>::start(
            &mut rng,
            code.as_bytes(),
        ))?;
        let response = auth(ServerRegistration::start(
            &setup,
            first.message,
            session.as_bytes(),
        ))?;
        let last = auth(first.state.finish(
            &mut rng,
            code.as_bytes(),
            response.message,
            ClientRegistrationFinishParameters::default(),
        ))?;
        let registration = ServerRegistration::finish(last.message)
            .serialize()
            .to_vec();
        Ok(Self {
            session,
            code,
            expiry: Instant::now() + Duration::from_secs(120),
            expiry_ms: SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64 + 120_000,
            setup,
            registration,
            attempts: 0,
            active: false,
            consumed: false,
        })
    }
    pub fn code(&self) -> &str {
        &self.code
    }
    pub fn session_id(&self) -> &str {
        &self.session
    }
    pub fn expires_at_ms(&self) -> u64 {
        self.expiry_ms
    }
    pub fn is_live(&self) -> bool {
        !self.consumed && Instant::now() < self.expiry && self.attempts < 5
    }

    pub fn begin(
        &mut self,
        session: &str,
        request: &[u8],
        context: &[u8],
    ) -> Result<(ServerHandshake, Vec<u8>)> {
        ensure!(
            session == self.session && self.is_live() && !self.active,
            "动态码已过期、正在使用或尝试次数已用尽"
        );
        self.attempts += 1;
        let registration = auth(ServerRegistration::deserialize(&self.registration))?;
        let request = auth(CredentialRequest::deserialize(request))?;
        let login = auth(ServerLogin::start(
            &mut OsRng,
            &self.setup,
            Some(registration),
            request,
            session.as_bytes(),
            ServerLoginParameters {
                context: Some(context),
                ..Default::default()
            },
        ))?;
        self.active = true;
        Ok((
            ServerHandshake {
                session: session.into(),
                state: login.state,
                context: context.to_owned(),
            },
            login.message.serialize().to_vec(),
        ))
    }

    pub fn finish(&mut self, handshake: ServerHandshake, finalization: &[u8]) -> Result<()> {
        ensure!(
            handshake.session == self.session && self.active && !self.consumed,
            "配对已失效"
        );
        self.active = false;
        ensure!(Instant::now() < self.expiry, "动态码已过期");
        let finalization = auth(CredentialFinalization::deserialize(finalization))?;
        auth(handshake.state.finish(
            finalization,
            ServerLoginParameters {
                context: Some(&handshake.context),
                ..Default::default()
            },
        ))?;
        self.consumed = true;
        Ok(())
    }

    pub fn cancel_attempt(&mut self, handshake: ServerHandshake) {
        if handshake.session == self.session {
            self.active = false;
        }
    }
}

impl ClientHandshake {
    pub fn start(code: &str) -> Result<(Self, Vec<u8>)> {
        ensure!(
            code.len() == 5 && code.bytes().all(|c| c.is_ascii_digit()),
            "请输入 5 位动态码"
        );
        let login = auth(ClientLogin::<Suite>::start(&mut OsRng, code.as_bytes()))?;
        Ok((
            Self {
                state: login.state,
                code: code.into(),
            },
            login.message.serialize().to_vec(),
        ))
    }

    pub fn finish(self, response: &[u8], context: &[u8]) -> Result<Vec<u8>> {
        let response = auth(CredentialResponse::deserialize(response))?;
        let result = auth(self.state.finish(
            &mut OsRng,
            self.code.as_bytes(),
            response,
            ClientLoginFinishParameters {
                context: Some(context),
                ..Default::default()
            },
        ))?;
        Ok(result.message.serialize().to_vec())
    }
}

pub fn pairing_context(
    exporter: &[u8; 32],
    server: &[u8],
    client: &[u8],
    session: &str,
) -> Vec<u8> {
    let mut context = b"syncfu-pair/v1\0server\0".to_vec();
    context.extend(Sha256::digest(server));
    context.extend(b"\0client\0");
    context.extend(Sha256::digest(client));
    context.extend(Sha256::digest(session.as_bytes()));
    context.extend(exporter);
    context
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_code_is_one_use_and_bound_to_channel_and_roles() -> Result<()> {
        let mut invite = Invite::new()?;
        let session = invite.session_id().to_owned();
        let code = invite.code().to_owned();
        assert_eq!(code.len(), 5);
        assert!(ClientHandshake::start("12345678").is_err());
        let context = pairing_context(&[1; 32], b"server", b"client", &session);
        for wrong_context in [
            pairing_context(&[2; 32], b"server", b"client", &session),
            pairing_context(&[1; 32], b"client", b"server", &session),
        ] {
            let (client, request) = ClientHandshake::start(&code)?;
            let (server, response) = invite.begin(&session, &request, &context)?;
            assert!(client.finish(&response, &wrong_context).is_err());
            invite.cancel_attempt(server);
        }
        let (client, request) = ClientHandshake::start(&code)?;
        let (server, response) = invite.begin(&session, &request, &context)?;
        let finalization = client.finish(&response, &context)?;
        invite.finish(server, &finalization)?;
        assert!(invite.begin(&session, &request, &context).is_err());
        Ok(())
    }

    #[test]
    fn wrong_code_attempt_limit_and_expiry() -> Result<()> {
        let mut invite = Invite::new()?;
        let session = invite.session_id().to_owned();
        let wrong = if invite.code() == "00000" {
            "11111"
        } else {
            "00000"
        };
        for _ in 0..5 {
            let (client, request) = ClientHandshake::start(wrong)?;
            let (server, response) = invite.begin(&session, &request, b"test")?;
            assert!(client.finish(&response, b"test").is_err());
            invite.cancel_attempt(server);
        }
        assert!(!invite.is_live());
        let mut expired = Invite::new()?;
        expired.expiry = Instant::now();
        assert!(!expired.is_live());
        Ok(())
    }
}
