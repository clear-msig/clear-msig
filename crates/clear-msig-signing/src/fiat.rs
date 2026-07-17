use super::*;

pub(super) fn write_fiat_estimate(
    writer: &mut Writer<'_>,
    estimate: Option<FiatEstimateInput<'_>>,
) -> Result<(), Error> {
    match estimate {
        Some(estimate) => {
            writer.u8(1)?;
            writer.bytes(estimate.amount)?;
            writer.bytes(estimate.currency)?;
            writer.bytes(estimate.source)?;
            writer.i64(estimate.observed_at)
        }
        None => writer.u8(0),
    }
}

fn read_fiat_estimate<'a>(reader: &mut Reader<'a>) -> Result<Option<FiatEstimate<'a>>, Error> {
    let estimate = match reader.u8()? {
        0 => None,
        1 => Some(FiatEstimate {
            amount: read_ascii(reader, 32)?,
            currency: read_ascii(reader, 8)?,
            source: read_ascii(reader, 64)?,
            observed_at: reader.i64()?,
        }),
        _ => return Err(Error::InvalidEncoding),
    };
    if let Some(estimate) = estimate {
        validate_fiat_estimate(estimate)?;
    }
    Ok(estimate)
}

pub(super) fn read_fiat_estimate_bytes<'a>(reader: &mut Reader<'a>) -> Result<&'a [u8], Error> {
    let before = reader.remaining();
    read_fiat_estimate(reader)?;
    let consumed = before.len() - reader.remaining().len();
    Ok(&before[..consumed])
}

impl<'a> Transfer<'a> {
    pub fn fiat_estimate(&self) -> Result<Option<FiatEstimate<'a>>, Error> {
        let mut reader = Reader::new(self.encoded_fiat_estimate);
        let estimate = read_fiat_estimate(&mut reader)?;
        if !reader.remaining().is_empty() {
            return Err(Error::TrailingBytes);
        }
        Ok(estimate)
    }
}
