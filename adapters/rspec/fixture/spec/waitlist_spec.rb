# frozen_string_literal: true

RSpec.describe Waitlist do
  it 'rejects a blank or @-less email', rule: 'fixture.join.rejects-invalid' do
    expect(Waitlist.join('')).to eq(error: 'Please enter a valid email address.')
    expect(Waitlist.join('   ')).to eq(error: 'Please enter a valid email address.')
    expect(Waitlist.join('not-an-email')).to eq(error: 'Please enter a valid email address.')
  end

  it 'confirms with the submitted email', rule: 'fixture.join.confirms-with-email' do
    expect(Waitlist.join('topher@profoundry.us'))
      .to eq(confirmation: "You're on the list! We'll email topher@profoundry.us.")
  end

  it 'rate limits repeated joins', rule: 'fixture.join.rate-limit' do
    pending 'not yet implemented'
    raise NotImplementedError
  end
end
